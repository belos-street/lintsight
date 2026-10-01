//! 规则层（T2.2 产品化）：`EngineRule` trait = Rust 轨道规则的唯一接入面。
//!
//! registry() 是全部引擎规则的登记处（Summary.rules 由此生成，将来 M2-DR5 的
//! source/sanitizer/sink 表交叠校验也挂在登记期）。规则 id 一律 `lintsight-engine/<name>`。
//! RawDiag 必须 arena 无关（全 owned/'static）——FileContext drop 后诊断仍存活。

use oxc_ast::AstKind;
use oxc_span::Span;

use crate::context::FileContext;
use crate::protocol::PathEvent;
use crate::taint::TaintTables;

pub struct RawDiag {
    pub rule_id: &'static str,
    pub severity: &'static str,
    pub message: String,
    pub span: Span,
    /// taint 规则证据链；普通规则为空
    pub path_events: Vec<PathEvent>,
}

pub trait EngineRule {
    fn id(&self) -> &'static str;
    fn check<'a>(&self, ctx: &FileContext<'a>) -> Vec<RawDiag>;
}

/// no-eval（T2.1 联通验证规则，CWE-95 动态代码执行）：oxlint 内置 no-eval 属
/// restriction 类未默认启用 → 语料零双报。span = 整个 CallExpression（保持 T2.1 口径）。
struct NoEval;

impl EngineRule for NoEval {
    fn id(&self) -> &'static str {
        "lintsight-engine/no-eval"
    }

    fn check<'a>(&self, ctx: &FileContext<'a>) -> Vec<RawDiag> {
        let mut out = Vec::new();
        for node in ctx.semantic().nodes().iter() {
            if let AstKind::CallExpression(call) = node.kind() {
                if let oxc_ast::ast::Expression::Identifier(ident) = &call.callee {
                    if ident.name == "eval" {
                        out.push(RawDiag {
                            rule_id: self.id(),
                            severity: "error",
                            message: "eval() allows arbitrary code execution; use safer alternatives. (no-eval)".into(),
                            span: call.span,
                            path_events: Vec::new(),
                        });
                    }
                }
            }
        }
        out
    }
}

/// no-path-traversal（CWE-22 路径穿越）函数表（M2-DR5 注册表 v0）：
/// readdir 是 source 不是 sink（spike ⑤ 教训 #1）；validate() 在登记期做交叠校验。
const PATH_TRAVERSAL_TABLES: TaintTables = TaintTables {
    name: "no-path-traversal",
    sources: &[("fs", "readdirSync")],
    propagators: &[("path", "join")],
    sanitizers: &[("path", "basename")],
    sinks: &[
        ("fs", "readFileSync"),
        ("fs", "readFile"),
        ("fs", "writeFileSync"),
        ("fs", "writeFile"),
        ("fs", "appendFileSync"),
        ("fs", "appendFile"),
    ],
};

/// no-path-traversal：外部可控文件名（readdirSync）未消毒抵达 fs 读写 sink。
/// span = sink 调用表达式；pathEvents = source→…→sink 证据链。
struct NoPathTraversal;

impl EngineRule for NoPathTraversal {
    fn id(&self) -> &'static str {
        "lintsight-engine/no-path-traversal"
    }

    fn check<'a>(&self, ctx: &FileContext<'a>) -> Vec<RawDiag> {
        crate::taint::run(ctx, &PATH_TRAVERSAL_TABLES)
            .into_iter()
            .map(|hit| RawDiag {
                rule_id: self.id(),
                severity: "error",
                message: format!(
                    "Untrusted filename from {}.{} reaches {}.{} without sanitization; validate against an allowlist or wrap with path.basename. (no-path-traversal)",
                    PATH_TRAVERSAL_TABLES.sources[0].0,
                    PATH_TRAVERSAL_TABLES.sources[0].1,
                    hit.func.0,
                    hit.func.1,
                ),
                span: hit.span,
                path_events: hit.events,
            })
            .collect()
    }
}

/// 全部引擎规则登记处（表交叠校验随登记执行——校验失败即引擎启动 panic，
/// Bun 侧 fail-open 降级，cargo test 提前拦截）
pub fn registry() -> Vec<Box<dyn EngineRule>> {
    PATH_TRAVERSAL_TABLES
        .validate()
        .expect("no-path-traversal 函数表交叠");
    vec![Box::new(NoEval), Box::new(NoPathTraversal)]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hits(source: &str) -> Vec<Span> {
        let allocator = oxc_allocator::Allocator::default();
        let mut spans = Vec::new();
        crate::context::with_context(&allocator, "a.ts", source, |ctx| {
            spans = NoEval.check(ctx).into_iter().map(|d| d.span).collect();
        });
        spans
    }

    #[test]
    fn detects_direct_eval_call() {
        let spans = hits("eval('1+1')\n");
        assert_eq!(spans.len(), 1);
        assert_eq!(spans[0].start, 0);
        assert_eq!(spans[0].end, 11); // 整个 CallExpression：eval('1+1') = 11 chars
    }

    #[test]
    fn ignores_member_call_and_clean_code() {
        assert!(hits("foo.eval('1')\n").is_empty());
        assert!(hits("const e = 1\nconsole.log(e)\n").is_empty());
    }

    // —— no-path-traversal（taint 竖切验收用例，对应 text-rpg readdir→join→readFile 场景） ——

    fn traversal_hits(source: &str) -> Vec<(u32, Vec<&'static str>)> {
        let allocator = oxc_allocator::Allocator::default();
        let mut out = Vec::new();
        crate::context::with_context(&allocator, "a.ts", source, |ctx| {
            for d in NoPathTraversal.check(ctx) {
                out.push((d.span.start, d.path_events.iter().map(|e| e.kind).collect()));
            }
        });
        out
    }

    const REaddir_JOIN_READ: &str = "\
import fs from 'node:fs'
import path from 'node:path'
const files = fs.readdirSync('./data')
for (const f of files) {
  fs.readFileSync(path.join('./data', f))
}
";

    #[test]
    fn detects_readdir_join_sink_loop() {
        let hits = traversal_hits(REaddir_JOIN_READ);
        assert_eq!(hits.len(), 1, "回边不动点收敛后 sink 只报一次");
        // 证据链完整：source → propagation(join) → sink
        assert_eq!(hits[0].1, vec!["source", "propagation", "sink"]);
    }

    #[test]
    fn sanitizer_flow_not_reported() {
        let src = "\
import fs from 'node:fs'
import path from 'node:path'
const files = fs.readdirSync('./data')
for (const f of files) {
  fs.readFileSync(path.join('./data', path.basename(f)))
}
";
        assert!(traversal_hits(src).is_empty(), "basename 消毒后不得误报");
    }

    #[test]
    fn detects_computed_index_sink() {
        let src = "\
import fs from 'node:fs'
const files = fs.readdirSync('./data')
fs.writeFileSync(files[0], 'x')
";
        let hits = traversal_hits(src);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].1, vec!["source", "sink"]);
    }

    #[test]
    fn clean_project_no_report() {
        assert!(
            traversal_hits("import fs from 'node:fs'\nfs.readFileSync('./config.json')\n")
                .is_empty()
        );
    }

    #[test]
    fn tables_have_no_overlap() {
        assert!(PATH_TRAVERSAL_TABLES.validate().is_ok());
    }
}
