//! 分析器（T2.1：no-eval 联通验证规则；T2.2 扩 semantic/CFG 消费层）。
//!
//! no-eval 选择的理由：真实且有意义的检查（CWE-95 动态代码执行）、实现极小（协议验证
//! 不被分析复杂度干扰）、oxlint 内置 no-eval 属 restriction 类未默认启用 → 语料零双报。

use crate::protocol::{Diagnostic, Span};

/// 行号表：offset → (line, column)，1-based
pub struct LineMap {
    starts: Vec<u32>,
}

impl LineMap {
    pub fn new(source: &str) -> Self {
        let mut starts = vec![0u32];
        for (i, b) in source.bytes().enumerate() {
            if b == b'\n' {
                starts.push(i as u32 + 1);
            }
        }
        Self { starts }
    }

    pub fn to_line_col(&self, offset: u32) -> (u32, u32) {
        let line = self.starts.partition_point(|&s| s <= offset) as u32;
        (line, offset - self.starts[(line - 1) as usize] + 1)
    }
}

pub fn analyze_file<'a>(
    allocator: &'a oxc_allocator::Allocator,
    rel_path: &str,
    source: &'a str,
) -> Vec<Diagnostic> {
    let source_type = oxc_span::SourceType::from_path(rel_path)
        .unwrap_or(oxc_span::SourceType::mjs());
    let ret = oxc_parser::Parser::new(allocator, source, source_type).parse();
    let line_map = LineMap::new(source);

    let mut diagnostics = Vec::new();
    for node in oxc_semantic::SemanticBuilder::new()
        .with_build_nodes(true)
        .build(&ret.program)
        .semantic
        .nodes()
        .iter()
    {
        if let oxc_ast::AstKind::CallExpression(call) = node.kind() {
            if let oxc_ast::ast::Expression::Identifier(ident) = &call.callee {
                if ident.name == "eval" {
                    let span: oxc_span::Span = call.span;
                    let (line, column) = line_map.to_line_col(span.start);
                    diagnostics.push(Diagnostic {
                        kind: "diagnostic",
                        rule_id: "lintsight-engine/no-eval".into(),
                        severity: "error",
                        message: "eval() allows arbitrary code execution; use safer alternatives. (no-eval)".into(),
                        file: rel_path.into(),
                        span: Span {
                            offset: span.start,
                            length: span.end - span.start,
                            line,
                            column,
                        },
                    });
                }
            }
        }
    }
    diagnostics
}
