//! 单文件分析驱动（T2.2）：FileContext 构建 → 规则遍历 → 协议诊断整形。
//!
//! 内存纪律的实现点：allocator/source 均由调用方按文件创建，本函数返回即随
//! 作用域释放；诊断整形在此完成（line/col 由 FileContext 的行号表换算），
//! 产出的 `Diagnostic` 全 owned，arena 释放后仍可安全输出。

use oxc_allocator::Allocator;

use crate::context::{with_context, FileContext};
use crate::protocol::{Diagnostic, Span};
use crate::rules::{EngineRule, RawDiag};

pub fn analyze_file(
    allocator: &Allocator,
    rel_path: &str,
    source: &str,
    rules: &[Box<dyn EngineRule>],
) -> Vec<Diagnostic> {
    with_context(allocator, rel_path, source, |ctx: &FileContext| {
        let mut out = Vec::new();
        for rule in rules {
            for raw in rule.check(ctx) {
                out.push(shape_diag(rel_path, ctx, raw));
            }
        }
        out
    })
}

fn shape_diag(rel_path: &str, ctx: &FileContext, raw: RawDiag) -> Diagnostic {
    let (line, column) = ctx.line_col(raw.span.start);
    Diagnostic {
        kind: "diagnostic",
        rule_id: raw.rule_id.into(),
        severity: raw.severity,
        message: raw.message,
        file: rel_path.into(),
        span: Span {
            offset: raw.span.start,
            length: raw.span.end - raw.span.start,
            line,
            column,
        },
    }
}
