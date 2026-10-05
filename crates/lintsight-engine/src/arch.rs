//! 架构规则（T2.4，design-m2 §4.1 arch-rules）：词法 import 图 + zone 依赖方向。
//!
//! 规则语义（`lintsight-engine/arch-boundaries`）：
//! - 文件按 `zone.match` **首匹配**归zone（配置顺序敏感，确定性）
//! - 同 zone 互引恒允许（内聚不需要配置列举）
//! - 跨 zone import 的目标必须命中该 zone 的 `allow` glob，否则报告
//! - 目标解析是**词法**的：相对导入（./ ../）按 importer 目录归一并 normalize；
//!   裸说明符走 tsconfig paths 别名兜底（FR-304① 支持嵌套 tsconfig：按 importer
//!   的最近祖先 tsconfig 选映射集，TS 语义），其余不解析——见误报复核清单
//!
//! 误报复核清单（v0 已知边界，登记于 docs/todo.md）：
//! 1. 别名解析：tsconfig paths 走引擎侧兜底（FR-304，stdin 下发归一化映射表，
//!    best-match 序 + 嵌套 tsconfig dir 归属）；package exports / paths 外的别名
//!    仍跳过——漏报不误报（exports 面约束由 no-deep-import 独立承担）
//! 2. require() 仅字面量形态；动态 import 仅字符串字面量
//! 3. 扩展名省略按词法 normalize（不 stat 文件系统）——zone glob 需按目录前缀书写
//! 4. re-export（export * from）覆盖；export {} from 覆盖
//! 5. zone 首匹配（顺序敏感）
//!
//! span = import source 字符串字面量；glob 支持段级 `*` 与跨段 `**`（自实现，
//! 避免 cargo 依赖扩张——cargo-deny 纪律）。

use oxc_ast::{ast::Expression, AstKind};
use oxc_span::Span;

use crate::context::FileContext;
use crate::protocol::{ArchConfig, PathEvent, TsPathMapping};

/// 段级 glob：`*` 单段内任意、`**` 跨任意段（含零段）、其余精确段匹配
pub fn glob_match(pattern: &str, path: &str) -> bool {
    let p: Vec<&str> = pattern.split('/').collect();
    let s: Vec<&str> = path.split('/').collect();
    match_segments(&p, &s)
}

fn match_segments(p: &[&str], s: &[&str]) -> bool {
    match p.first() {
        None => s.is_empty(),
        Some(&"**") => {
            // ** 吞零段或多段
            (0..=s.len()).any(|i| match_segments(&p[1..], &s[i..]))
        }
        Some(seg) => {
            if s.is_empty() {
                return false;
            }
            seg_star_match(seg, s[0]) && match_segments(&p[1..], &s[1..])
        }
    }
}

/// 段内匹配：`*` 通配符（简化实现——* 只支持「前缀*后缀」单星形态）
fn seg_star_match(seg: &str, text: &str) -> bool {
    match seg.split_once('*') {
        None => seg == text,
        Some((prefix, suffix)) => {
            text.len() >= prefix.len() + suffix.len()
                && text.starts_with(prefix)
                && text.ends_with(suffix)
        }
    }
}

/// 相对导入 → 相对 root 的词法路径（不 stat 文件系统）；裸说明符返回 None
fn resolve_import(importer_rel: &str, specifier: &str) -> Option<String> {
    if !(specifier.starts_with("./") || specifier.starts_with("../")) {
        return None;
    }
    let mut dir: Vec<&str> = importer_rel.split('/').collect();
    dir.pop(); // 去 importer 文件名，留目录
    let mut stack: Vec<&str> = Vec::new();
    let base = if specifier.starts_with('/') {
        vec![]
    } else {
        dir
    };
    for part in base.into_iter().chain(specifier.split('/')) {
        match part {
            "" | "." => {}
            ".." => {
                stack.pop();
            }
            seg => stack.push(seg),
        }
    }
    Some(stack.join("/"))
}

/// tsconfig paths 别名兜底（FR-304）：裸说明符 → 词法目标路径。
/// FR-304① 嵌套 tsconfig：`ts_paths` 各条带 `dir`（ owning tsconfig 目录，""=根），
/// 按 importer 的**最近祖先 tsconfig**（dir 是 importer 目录或其祖先、路径最长者）
/// 过滤出适用集，再在其中做 best-match（映射表已由 Bun 侧按固定前缀排序，
/// 过滤保序）。多 target 取首个（词法模式无文件系统可验证存在性）。
/// 未命中返回 None → 调用方维持跳过语义（漏报不误报）。
fn resolve_alias(
    importer_rel: &str,
    specifier: &str,
    ts_paths: &[TsPathMapping],
) -> Option<String> {
    // 适用集：dir 为 importer 目录或其祖先（含根 ""）中 dir 最深的一层。
    // 同层过滤必须同时校验 applies——兄弟目录（packages/a vs packages/b）等长但不适用。
    let applicable: Vec<&TsPathMapping> = ts_paths
        .iter()
        .filter(|m| {
            !m.dir.is_empty()
                && (importer_rel == m.dir || importer_rel.starts_with(&format!("{}/", m.dir)))
        })
        .collect();
    let deepest = applicable.iter().map(|m| m.dir.len()).max();
    let applicable: Vec<&TsPathMapping> = match deepest {
        Some(l) => applicable
            .into_iter()
            .filter(|m| m.dir.len() == l)
            .collect(),
        // importer 无嵌套祖先 tsconfig → 回退根 dir=""（无根条目则空 = 跳过别名）
        None => ts_paths.iter().filter(|m| m.dir.is_empty()).collect(),
    };
    for m in applicable {
        let target = match m.pattern.split_once('*') {
            None => {
                if specifier != m.pattern {
                    continue;
                }
                m.targets.first()?.clone()
            }
            Some((prefix, suffix)) => {
                let mid = specifier.strip_prefix(prefix)?.strip_suffix(suffix)?;
                match m.targets.first() {
                    Some(t) => t.replacen('*', mid, 1),
                    None => continue,
                }
            }
        };
        return Some(target);
    }
    None
}

pub struct ArchViolation {
    pub span: Span,
    pub target: String,
    pub from_zone: String,
    pub to_zone: Option<String>,
}

/// import 说明符抽取（arch / no-import-cycle / no-deep-import 三方共用）：
/// 静态 import、export-from、`export * from`、字符串字面量动态 import、
/// require('x') 字面量。返回 (specifier, source 字面量 span, is_type_only)，
/// 按源码序。type-only（`import type` / `export type from`）由调用方自行取舍：
/// 图 pass（循环检测）必须过滤——TS 擦除后无运行时环；arch/deep-import 保留
/// （编译期耦合与类型泄漏仍属约束面）。
pub fn collect_specifiers(ctx: &FileContext) -> Vec<(String, Span, bool)> {
    let mut out = Vec::new();
    for node in ctx.semantic().nodes().iter() {
        let (specifier, span, type_only): (&str, Span, bool) = match node.kind() {
            AstKind::ImportDeclaration(d) => (
                d.source.value.as_str(),
                d.source.span,
                d.import_kind.is_type(),
            ),
            AstKind::ExportAllDeclaration(d) => (
                d.source.value.as_str(),
                d.source.span,
                d.export_kind.is_type(),
            ),
            // `export { x } from 'y'`（0.150 起独立节点 ExportFromDeclaration）
            AstKind::ExportFromDeclaration(d) => (
                d.source.value.as_str(),
                d.source.span,
                d.export_kind.is_type(),
            ),
            AstKind::ImportExpression(e) => match &e.source {
                Expression::StringLiteral(s) => (s.value.as_str(), s.span, false),
                _ => continue, // 非字面量动态导入 v0 不解析（复核清单 #2）
            },
            AstKind::CallExpression(call) => {
                // require('x') 字面量形态
                let is_require =
                    matches!(&call.callee, Expression::Identifier(i) if i.name == "require");
                if !is_require {
                    continue;
                }
                match call.arguments.first().and_then(|a| a.as_expression()) {
                    Some(Expression::StringLiteral(s)) => (s.value.as_str(), s.span, false),
                    _ => continue,
                }
            }
            _ => continue,
        };
        out.push((specifier.to_string(), span, type_only));
    }
    out
}

/// import 说明符 → 词法目标（相对 root）：相对导入词法解析 →
/// 裸说明符 tsconfig paths 兜底（FR-304①）→ 仍未命中 None（跳过语义）
pub fn resolve_target(
    importer_rel: &str,
    specifier: &str,
    ts_paths: &[TsPathMapping],
) -> Option<String> {
    resolve_import(importer_rel, specifier).or_else(|| resolve_alias(importer_rel, specifier, ts_paths))
}

/// 单文件架构检查：返回越界 import 列表（按源码序，确定性）
pub fn check_file(
    ctx: &FileContext,
    config: &ArchConfig,
    ts_paths: &[TsPathMapping],
) -> Vec<ArchViolation> {
    let Some(from) = zone_of(config, ctx.rel_path()) else {
        return Vec::new(); // 未归 zone 的文件不受约束
    };
    let mut out = Vec::new();
    for (specifier, span, _) in collect_specifiers(ctx) {
        let target = match resolve_target(ctx.rel_path(), &specifier, ts_paths) {
            Some(t) => t,
            None => continue,
        };
        let to = zone_of(config, &target);
        if to.is_some_and(|z| z.name == from.name) {
            continue; // 同 zone 内聚
        }
        let allowed = from.allow.iter().any(|pat| glob_match(pat, &target));
        if !allowed {
            out.push(ArchViolation {
                span,
                target,
                from_zone: from.name.clone(),
                to_zone: to.map(|z| z.name.clone()),
            });
        }
    }
    out
}

/// 文件/目标归属 zone：match 首匹配（配置顺序 = 优先级，确定性）
fn zone_of<'c>(config: &'c ArchConfig, rel: &str) -> Option<&'c crate::protocol::ArchZone> {
    config
        .zones
        .iter()
        .find(|z| z.match_paths.iter().any(|pat| glob_match(pat, rel)))
}

pub fn rule_id() -> &'static str {
    "lintsight-engine/arch-boundaries"
}

/// 规则接入（rules.rs 调用）：诊断整形
pub fn run(
    ctx: &FileContext,
    config: &ArchConfig,
    ts_paths: &[TsPathMapping],
) -> Vec<crate::rules::RawDiag> {
    check_file(ctx, config, ts_paths)
        .into_iter()
        .map(|v| crate::rules::RawDiag {
            rule_id: rule_id(),
            severity: "error",
            message: match &v.to_zone {
                Some(to) => format!(
                    "Import '{}' crosses zone boundary: '{}' → '{}' is not in the allowed list. (arch-boundaries)",
                    v.target, v.from_zone, to
                ),
                None => format!(
                    "Import '{}' leaves zone '{}' and the target is not in the allowed list. (arch-boundaries)",
                    v.target, v.from_zone
                ),
            },
            span: v.span,
            path_events: Vec::<PathEvent>::new(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn glob_segment_and_recursive() {
        assert!(glob_match("src/**", "src/a/b.ts"));
        assert!(glob_match("src/**", "src/a.ts"));
        assert!(!glob_match("src/**", "lib/a.ts"));
        assert!(glob_match("packages/*/src/**", "packages/cli/src/x.ts"));
        assert!(!glob_match("packages/*/src/**", "packages/cli/test/x.ts"));
        assert!(glob_match("src/*.ts", "src/a.ts"));
        assert!(!glob_match("src/*.ts", "src/a/b.ts"));
        // ** 可吞零段
        assert!(glob_match("a/**/b.ts", "a/b.ts"));
        assert!(glob_match("a/**/b.ts", "a/x/y/b.ts"));
    }

    #[test]
    fn resolve_lexical_paths() {
        assert_eq!(
            resolve_import("src/a/b.ts", "../util/c"),
            Some("src/util/c".into())
        );
        assert_eq!(resolve_import("src/a/b.ts", "./d"), Some("src/a/d".into()));
        assert_eq!(resolve_import("src/a/b.ts", "lodash"), None);
        assert_eq!(
            resolve_import("src/a/b.ts", "../../x/../y"),
            Some("y".into())
        );
    }

    #[test]
    fn resolve_alias_tsconfig_paths() {
        let mappings = |v: &str| -> Vec<TsPathMapping> { serde_json::from_str(v).unwrap() };
        // 通配 pattern：捕获 `*` 中段替换进 target
        let m: Vec<TsPathMapping> = mappings(r#"[{"pattern":"@app/*","targets":["src/app/*"]}]"#);
        assert_eq!(
            resolve_alias("src/other/a.ts", "@app/user/service", &m),
            Some("src/app/user/service".into())
        );
        // 精确 pattern（无 *）
        let m: Vec<TsPathMapping> =
            mappings(r#"[{"pattern":"@config","targets":["src/config/index"]}]"#);
        assert_eq!(
            resolve_alias("src/a.ts", "@config", &m),
            Some("src/config/index".into())
        );
        assert_eq!(
            resolve_alias("src/a.ts", "@config/x", &m),
            None,
            "精确 pattern 不做前缀匹配"
        );
        // 未命中 → None（调用方维持跳过语义）
        assert_eq!(resolve_alias("src/a.ts", "lodash", &m), None);
        // 空 targets → 跳过该条
        let m: Vec<TsPathMapping> = mappings(r#"[{"pattern":"@dead/*","targets":[]}]"#);
        assert_eq!(resolve_alias("src/a.ts", "@dead/a", &m), None);
    }

    #[test]
    fn resolve_alias_nested_tsconfig_nearest_ancestor_wins() {
        // FR-304①：同 pattern 在根与嵌套包各有映射 → importer 落在包内用包的，
        // 包外用根的；兄弟包条目不得串扰
        let m: Vec<TsPathMapping> = serde_json::from_str(
            r#"[
            {"dir":"","pattern":"@a/*","targets":["root/*"]},
            {"dir":"packages/x","pattern":"@a/*","targets":["packages/x/src/*"]},
            {"dir":"packages/y","pattern":"@a/*","targets":["packages/y/src/*"]}
        ]"#,
        )
        .unwrap();
        // 包内：最近祖先 = packages/x
        assert_eq!(
            resolve_alias("packages/x/src/a.ts", "@a/util", &m),
            Some("packages/x/src/util".into())
        );
        // 兄弟包 y 的映射不得命中 x 内文件（同 len 目录串扰哨兵）
        assert_eq!(
            resolve_alias("packages/x/src/a.ts", "@a/util", &m),
            Some("packages/x/src/util".into())
        );
        // 包外：回退根映射
        assert_eq!(
            resolve_alias("scripts/build.ts", "@a/tool", &m),
            Some("root/tool".into())
        );
        // 深层嵌套：多层祖先取最深
        let m2: Vec<TsPathMapping> = serde_json::from_str(
            r#"[
            {"dir":"apps","pattern":"@c/*","targets":["apps/*"]},
            {"dir":"apps/web","pattern":"@c/*","targets":["apps/web/src/*"]}
        ]"#,
        )
        .unwrap();
        assert_eq!(
            resolve_alias("apps/web/lib/a.ts", "@c/x", &m2),
            Some("apps/web/src/x".into())
        );
    }

    #[test]
    fn collect_specifiers_marks_type_only() {
        let allocator = oxc_allocator::Allocator::default();
        crate::context::with_context(
            &allocator,
            "a.ts",
            "import type { T } from './t'\nimport { v } from './v'\nexport type { T2 } from './t2'\nexport { x } from './x'\n",
            |ctx| {
                let specs = collect_specifiers(ctx);
                assert_eq!(specs.len(), 4);
                assert!(specs[0].2, "import type 应标记 type-only");
                assert!(!specs[1].2);
                assert!(specs[2].2, "export type from 应标记 type-only");
                assert!(!specs[3].2);
            },
        );
    }

    #[test]
    fn zone_first_match_wins() {
        let cfg: ArchConfig = serde_json::from_str(
            r#"{"zones":[
                {"name":"core","match":["src/core/**"],"allow":[]},
                {"name":"all","match":["src/**"],"allow":["src/**"]}
            ]}"#,
        )
        .unwrap();
        assert_eq!(zone_of(&cfg, "src/core/a.ts").unwrap().name, "core");
        assert_eq!(zone_of(&cfg, "src/other/a.ts").unwrap().name, "all");
        assert!(zone_of(&cfg, "lib/a.ts").is_none());
    }
}
