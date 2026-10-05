//! 公共 API 泄漏检测（FR-304③，`lintsight-engine/no-deep-import`）：
//! package.json `exports` 面约束——导入声明了 exports 的 workspace 包时，
//! 子路径必须命中 exports 键集，否则报告（深导入绕过公共 API 面）。
//!
//! 语义（v0）：
//! - 包发现：引擎自扫 root 下递归找 package.json（跳 node_modules/.git/dist 等
//!   产物目录），`exports` 字段存在的包才纳入约束（legacy 包不约束——漏报不误报）
//! - 匹配：`pkg` → 键 `.`；`pkg/sub/x` → 键 `./sub/x`，键支持单 `*` 模式
//!   （exports 的 pattern 语义子集）；条件对象（import/require/types）只在任意
//!   层级收集 `.` 开头的键，不解析条件分支
//! - 边界：外部 npm 依赖（node_modules）不解析不约束；`#imports` 私有导入不约束；
//!   无 exports 键集的包整个跳过
//!
//! 确定性：目录遍历按文件名排序；键集 BTreeSet 排序；诊断按源码序。

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use oxc_span::Span;

use crate::context::FileContext;
use crate::protocol::PathEvent;

/// 递归遍历要跳过的目录名（产物/依赖/隐藏目录；工程治理面不进这些树）
const SKIP_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    ".lintsight-cache",
    "dist",
    "build",
    "coverage",
    ".next",
    ".nuxt",
    "target",
];

/// 发现 root 树内声明了 exports 的包：包名 → 包根（相对 root 的 POSIX 路径）
/// + exports 键集。同名包（嵌套重名）首发现优先（BTreeMap 已有序）。
pub fn discover(root: &Path) -> BTreeMap<String, PackageInfo> {
    let mut out = BTreeMap::new();
    walk(root, root, &mut out, 0);
    out
}

fn walk(dir: &Path, root: &Path, out: &mut BTreeMap<String, PackageInfo>, depth: usize) {
    // 深度护栏：异常深树不无限走
    if depth > 32 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut names: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .collect();
    names.sort(); // 确定性遍历
    for p in names {
        let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if p.is_dir() {
            if SKIP_DIRS.contains(&name) || name.starts_with('.') {
                continue;
            }
            walk(&p, root, out, depth + 1);
        } else if name == "package.json" {
            if let Ok(text) = std::fs::read_to_string(&p) {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                    let Some(pkg_name) = v.get("name").and_then(|n| n.as_str()) else {
                        continue;
                    };
                    let Some(exports) = v.get("exports") else {
                        continue; // 无 exports 字段 → 不约束（legacy）
                    };
                    let keys = collect_export_keys(exports);
                    if keys.is_empty() {
                        continue;
                    }
                    let root_rel = p
                        .parent()
                        .and_then(|d| d.strip_prefix(root).ok())
                        .map(|d| d.to_string_lossy().to_string())
                        .unwrap_or_default();
                    out.entry(pkg_name.to_string()).or_insert(PackageInfo {
                        root_rel,
                        keys,
                    });
                }
            }
        }
    }
}

#[derive(Clone)]
pub struct PackageInfo {
    /// 包根相对 root（POSIX；root 自身的 package.json → ""）
    #[allow(dead_code)]
    pub root_rel: String,
    /// exports 键集（"."、"./sub/*"…，条件对象任意层级的点键）
    pub keys: BTreeSet<String>,
}

/// 收集 exports 值中所有层级的点开头的键（string → {"."}；object → 点键递归；
/// array → 元素递归）
fn collect_export_keys(v: &serde_json::Value) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    collect_keys_inner(v, &mut out);
    out
}

fn collect_keys_inner(v: &serde_json::Value, out: &mut BTreeSet<String>) {
    match v {
        serde_json::Value::String(_) => {
            out.insert(".".to_string());
        }
        serde_json::Value::Array(items) => {
            for it in items {
                collect_keys_inner(it, out);
            }
        }
        serde_json::Value::Object(map) => {
            for (k, sub) in map {
                if k.starts_with('.') {
                    out.insert(k.to_string());
                } else {
                    // 条件键（import/require/types/default…）继续下钻
                    collect_keys_inner(sub, out);
                }
            }
        }
        _ => {}
    }
}

/// 子路径是否命中键集：精确匹配或单 `*` 模式（`./sub/*` 前后缀匹配）
fn key_matches(key: &str, subpath: &str) -> bool {
    if !key.contains('*') {
        return key == subpath;
    }
    match key.split_once('*') {
        Some((prefix, suffix)) => {
            subpath.len() >= prefix.len() + suffix.len()
                && subpath.starts_with(prefix)
                && subpath.ends_with(suffix)
        }
        None => false,
    }
}

pub struct DeepImportViolation {
    pub span: Span,
    pub specifier: String,
    pub pkg: String,
}

/// 单文件检查：导入声明了 exports 的包时子路径必须命中键集。
/// `pkg` 裸名（键 "."）与 `pkg/sub`（键 "./sub"）两种形态。
pub fn check_file(
    ctx: &FileContext,
    packages: &BTreeMap<String, PackageInfo>,
) -> Vec<DeepImportViolation> {
    let mut out = Vec::new();
    for (specifier, span, _) in crate::arch::collect_specifiers(ctx) {
        // 定位包：最长名字前缀命中（@scope/name 优先于同名前缀的短名）
        let Some((pkg, info)) = find_package(packages, &specifier) else {
            continue;
        };
        let subpath = specifier
            .strip_prefix(&pkg)
            .and_then(|rest| rest.strip_prefix('/'))
            .map(|rest| format!("./{rest}"))
            .unwrap_or_else(|| ".".to_string());
        if !info.keys.iter().any(|k| key_matches(k, &subpath)) {
            out.push(DeepImportViolation {
                span,
                specifier,
                pkg,
            });
        }
    }
    out
}

fn find_package<'m>(
    packages: &'m BTreeMap<String, PackageInfo>,
    specifier: &str,
) -> Option<(String, &'m PackageInfo)> {
    // 精确名 + '/' 边界；取名字最长命中（防 'api' 吞 '@api/x'—— scoped 名带 @，
    // 但 'api-extra' 不是 'api' 的子路径）
    let mut best: Option<(&String, &PackageInfo)> = None;
    for (name, info) in packages {
        let is_match = specifier == name.as_str()
            || (specifier.len() > name.len()
                && specifier.starts_with(name.as_str())
                && specifier.as_bytes()[name.len()] == b'/');
        if is_match && best.is_none_or(|(b, _)| name.len() > b.len()) {
            best = Some((name, info));
        }
    }
    best.map(|(n, i)| (n.clone(), i))
}

pub fn rule_id() -> &'static str {
    "lintsight-engine/no-deep-import"
}

/// 规则接入（rules.rs 调用）：诊断整形
pub fn run(
    ctx: &FileContext,
    packages: &BTreeMap<String, PackageInfo>,
) -> Vec<crate::rules::RawDiag> {
    check_file(ctx, packages)
        .into_iter()
        .map(|v| crate::rules::RawDiag {
            rule_id: rule_id(),
            severity: "error",
            message: format!(
                "Import '{}' bypasses the public API of package '{}': the subpath is not in its package.json exports map. Import the package root or an exported subpath. (no-deep-import)",
                v.specifier, v.pkg
            ),
            span: v.span,
            path_events: Vec::<PathEvent>::new(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info(keys: &[&str]) -> PackageInfo {
        PackageInfo {
            root_rel: String::new(),
            keys: keys.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn export_keys_from_all_shapes() {
        let to_vec = |s: BTreeSet<String>| s.into_iter().collect::<Vec<String>>();
        // string 形态
        let keys = to_vec(collect_export_keys(&serde_json::json!("./main.js")));
        assert_eq!(keys, ["."]);
        // 对象 + 条件下钻
        let keys = to_vec(collect_export_keys(&serde_json::json!({
            ".": { "import": "./x.mjs", "require": "./x.cjs" },
            "./sub/*": "./src/*.js"
        })));
        assert_eq!(keys, [".", "./sub/*"]);
        // 条件内嵌点键（深层形态）
        let keys = to_vec(collect_export_keys(&serde_json::json!({
            "types": "./t.d.ts",
            ".": { "types": "./a.d.ts", "default": "./a.js" }
        })));
        assert_eq!(keys, ["."]);
    }

    #[test]
    fn discover_finds_packages_and_skips_nodes() {
        let base = std::env::temp_dir().join(format!(
            "lintsight-pkgexp-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let mk = |rel: &str| {
            let p = base.join(rel);
            std::fs::create_dir_all(&p).unwrap();
            p
        };
        let write = |p: &Path, text: &str| std::fs::write(p, text).unwrap();
        // 包 1：root 直下，exports 对象形态
        write(
            &mk("packages/api").join("package.json"),
            r#"{"name":"@app/api","exports":{".":"./src/index.ts","./internal":"./src/internal.ts"}}"#,
        );
        // 包 2：nested，string 形态
        write(
            &mk("apps/web").join("package.json"),
            r#"{"name":"web","exports":"./main.js"}"#,
        );
        // node_modules 内的 package.json 必须跳过
        write(
            &mk("packages/api/node_modules/dep").join("package.json"),
            r#"{"name":"dep","exports":{".":"./x.js"}}"#,
        );
        // 无 exports 字段 → 不入册
        write(&mk("legacy").join("package.json"), r#"{"name":"legacy"}"#);

        let pkgs = discover(&base);
        std::fs::remove_dir_all(&base).ok();

        assert_eq!(pkgs.len(), 2, "node_modules 跳过 + legacy 无 exports 不入册");
        assert!(pkgs.contains_key("@app/api"));
        assert_eq!(pkgs["web"].keys, BTreeSet::from([".".to_string()]));
    }

    #[test]
    fn key_matching_patterns() {
        assert!(key_matches(".", "."));
        assert!(key_matches("./sub/*", "./sub/a/b"));
        assert!(!key_matches("./sub/*", "./other/a"));
        assert!(!key_matches("./sub", "./sub/extra"));
    }

    #[test]
    fn package_prefix_boundary() {
        let mut pkgs: BTreeMap<String, PackageInfo> = BTreeMap::new();
        pkgs.insert("api".to_string(), info(&["."]));
        pkgs.insert("@scope/api".to_string(), info(&[".", "./lib/*"]));
        // 'api-extra' 不是 'api' 的子路径（边界）
        assert!(find_package(&pkgs, "api-extra").is_none());
        // scoped 名最长命中
        let (name, _) = find_package(&pkgs, "@scope/api/lib/x").unwrap();
        assert_eq!(name, "@scope/api");
        let (name, _) = find_package(&pkgs, "api").unwrap();
        assert_eq!(name, "api");
    }

    #[test]
    fn deep_import_detection_and_clean_pass() {
        let mut pkgs: BTreeMap<String, PackageInfo> = BTreeMap::new();
        pkgs.insert("api".to_string(), info(&[".", "./public/*"]));
        let allocator = oxc_allocator::Allocator::default();

        // 深导入：未在 exports 键集 → 报
        let mut out = Vec::new();
        crate::context::with_context(
            &allocator,
            "app.ts",
            "import { x } from 'api/src/internal'\nimport { y } from 'api/public/ok'\nimport api from 'api'\n",
            |ctx| {
                out = crate::pkgexports::run(ctx, &pkgs);
            },
        );
        assert_eq!(out.len(), 1);
        assert!(out[0].message.contains("'api/src/internal'"));

        // 相对导入与未知包不约束
        let mut out = Vec::new();
        crate::context::with_context(
            &allocator,
            "app.ts",
            "import './local'\nimport fs from 'node:fs'\nimport other from 'not-a-pkg'\n",
            |ctx| {
                out = crate::pkgexports::run(ctx, &pkgs);
            },
        );
        assert!(out.is_empty());
    }
}
