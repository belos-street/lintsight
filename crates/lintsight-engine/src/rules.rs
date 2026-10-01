//! 规则层（T2.2 产品化）：`EngineRule` trait = Rust 轨道规则的唯一接入面。
//!
//! registry() 是全部引擎规则的登记处（Summary.rules 由此生成，将来 M2-DR5 的
//! source/sanitizer/sink 表交叠校验也挂在登记期）。规则 id 一律 `lintsight-engine/<name>`。
//! RawDiag 必须 arena 无关（全 owned/'static）——FileContext drop 后诊断仍存活。

use oxc_ast::AstKind;
use oxc_span::Span;

use crate::context::FileContext;

pub struct RawDiag {
    pub rule_id: &'static str,
    pub severity: &'static str,
    pub message: String,
    pub span: Span,
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
                        });
                    }
                }
            }
        }
        out
    }
}

/// 全部引擎规则登记处
pub fn registry() -> Vec<Box<dyn EngineRule>> {
    vec![Box::new(NoEval)]
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
}
