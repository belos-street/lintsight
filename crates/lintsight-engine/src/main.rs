//! lintsight-engine —— M2 深度分析引擎（Rust sidecar，design-m2 §4.1）。
//!
//! 协议（M2-DR1，JSON Lines）：
//!   输入：`lintsight-engine --root <dir>` + stdin JSON `{"files": ["<相对/绝对路径>", …]}`
//!   输出：stdout 逐行 JSON——
//!     {"type":"diagnostic","ruleId":"lintsight-engine/<name>","severity":"error|warning",
//!      "message":"…","file":"…","span":{"offset":n,"length":n,"line":n,"column":n}}
//!     {"type":"summary","files":n,"rules":["lintsight-engine/<name>",…]}
//!
//! 失败语义：任何输入异常 → stderr 输出错误 + exit 2，Bun 侧 fail-open 降级纯 M1 扫描。
//! T2.2 范围：FileContext 消费层（semantic+CFG 查询面）+ 规则 trait + 流式分配
//! （每文件独立 arena，分析完即 drop——峰值 ≈ 最大单文件，与批大小无关）。
//! FR-304②③：importCycles（图后处理 pass）与 enforceExports（包表发现 +
//! no-deep-import 规则）均为 opt-in，关闭时零额外开销。

mod analyze;
mod arch;
mod context;
mod graph;
mod pkgexports;
mod protocol;
mod rules;
mod taint;

use std::collections::BTreeMap;
use std::io::{self, Read};

use oxc_allocator::Allocator;
use rayon::prelude::*;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let root = args
        .iter()
        .position(|a| a == "--root")
        .and_then(|i| args.get(i + 1))
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::env::current_dir().expect("cwd"));

    let mut stdin = String::new();
    io::stdin()
        .read_to_string(&mut stdin)
        .unwrap_or_else(|e| protocol::fatal(&format!("stdin read failed: {e}")));
    let input: protocol::EngineInput = serde_json::from_str(&stdin)
        .unwrap_or_else(|e| protocol::fatal(&format!("stdin JSON parse failed: {e}")));

    let ts_paths = input.ts_paths.unwrap_or_default();
    let want_cycles = input.arch.as_ref().is_some_and(|a| a.import_cycles);
    let want_exports = input.arch.as_ref().is_some_and(|a| a.enforce_exports);

    // FR-304③：exports 包表发现（opt-in；失败按空表处理 = 规则不注册，fail-open）
    let packages: BTreeMap<String, pkgexports::PackageInfo> = if want_exports {
        pkgexports::discover(&root)
    } else {
        BTreeMap::new()
    };

    let rules = rules::registry(
        input.arch.as_ref(),
        &ts_paths,
        if want_exports { Some(&packages) } else { None },
    );

    // 文件级并行（T2.6）：rayon par_iter，collect 保序 → 诊断顺序与串行一致
    //（M1-DR4 确定性）；每文件独立 arena，峰值 ≈ 线程数 × 最大单文件
    let file_results: Vec<Option<(analyze::FileOutput, String)>> = input
        .files
        .par_iter()
        .map(|file| {
            let abs = if file.starts_with('/') {
                std::path::PathBuf::from(file)
            } else {
                root.join(file)
            };
            let Ok(source) = std::fs::read_to_string(&abs) else {
                return None; // 读不到的文件跳过（Bun 侧已做过存在性筛选）
            };
            let rel = abs
                .strip_prefix(&root)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|_| file.clone());
            let allocator = Allocator::default();
            let out = analyze::analyze_file(
                &allocator,
                &rel,
                &source,
                &rules,
                want_cycles, // 边原料仅循环检测开启时收集（零开销原则）
            );
            Some((out, rel))
        })
        .collect();

    let mut diagnostics = Vec::new();
    let mut scanned = 0usize;
    // FR-304②：词法 import 边表（扩展名剥离归一；解析口径与 arch-boundaries 一致）。
    // node2real：剥离键 → 真实 rel 路径（诊断 file 必须用真实路径，合并层按
    // scanRel 映射回报告文件）
    let mut edges: graph::EdgeTable = BTreeMap::new();
    let mut node2real: BTreeMap<String, String> = BTreeMap::new();
    for result in file_results {
        if let Some((out, rel)) = result {
            diagnostics.extend(out.diagnostics);
            if want_cycles {
                let node = graph::strip_extension(&rel);
                node2real.entry(node.clone()).or_insert(rel.clone());
                let targets: &mut Vec<(String, oxc_span::Span)> =
                    edges.entry(node).or_default();
                for (specifier, span, type_only) in out.specifiers {
                    // type-only import TS 擦除后无运行时环 → 图边不收
                    if type_only {
                        continue;
                    }
                    if let Some(target) =
                        arch::resolve_target(&rel, &specifier, &ts_paths)
                    {
                        targets.push((graph::strip_extension(&target), span));
                    }
                }
            }
            scanned += 1;
        }
    }

    if want_cycles {
        for mut cycle in graph::detect_cycles(&edges) {
            // 环链展示与 file 定位都用真实路径（扩展名回归）
            for n in &mut cycle.cycle {
                if let Some(real) = node2real.get(n) {
                    *n = real.clone();
                }
            }
            cycle.file = node2real.get(&cycle.file).cloned().unwrap_or(cycle.file);
            let (line, column) = line_col_of(&root, &cycle);
            diagnostics.push(protocol::Diagnostic {
                kind: "diagnostic",
                rule_id: "lintsight-engine/no-import-cycle".into(),
                severity: "error",
                message: format!(
                    "Import cycle detected: {}. Breaking the cycle (e.g. via an intermediate module or dependency inversion) keeps module boundaries clean. (no-import-cycle)",
                    cycle.cycle.join(" → ")
                ),
                file: cycle.file,
                span: protocol::Span {
                    offset: cycle.span.start,
                    length: cycle.span.end - cycle.span.start,
                    line,
                    column,
                },
                path_events: Vec::new(),
            });
        }
    }

    for d in &diagnostics {
        protocol::emit_line(d);
    }
    let summary = protocol::Summary {
        kind: "summary",
        files: scanned,
        rules: rules.iter().map(|r| r.id().to_string()).collect(),
    };
    protocol::emit_line(&summary);
}

/// 图诊断的行号换算：edges 内 span 是 oxc Span（offset 起算）——需要该文件源码。
/// 独立 helper：重新读源码 + 行号表（每 cycle 文件至多一次，环文件是少数）。
fn line_col_of(root: &std::path::Path, cycle: &graph::CycleDiag) -> (u32, u32) {
    let abs = root.join(&cycle.file);
    if let Ok(source) = std::fs::read_to_string(&abs) {
        let lm = context::LineMap::new(&source);
        return lm.to_line_col(cycle.span.start);
    }
    (1, 1) // 读不到源码（扫描后被删等）→ 退化 1:1，不阻塞输出
}
