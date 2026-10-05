//! 单文件分析驱动（T2.2）：FileContext 构建 → 规则遍历 → 协议诊断整形。
//!
//! 内存纪律的实现点：allocator/source 均由调用方按文件创建，本函数返回即随
//! 作用域释放；诊断整形在此完成（line/col 由 FileContext 的行号表换算），
//! 产出的 `Diagnostic` 全 owned，arena 释放后仍可安全输出。
//!
//! `collect_imports` = 循环依赖图 pass（FR-304②）的边原料：开启时顺带抽取
//! import 说明符（span 为 oxc Span 纯数据，arena 无关）——只在配置开关打开时
//! 收集，关闭时零额外开销（taint-only 扫描路径不变）。

use oxc_allocator::Allocator;
use oxc_span::Span as RawSpan;

use crate::context::{with_context, FileContext};
use crate::protocol::{Diagnostic, Span};
use crate::rules::{EngineRule, RawDiag};

pub struct FileOutput {
    pub diagnostics: Vec<Diagnostic>,
    /// (specifier, source 字面量 span, is_type_only)——仅 collect_imports=true 时非空
    pub specifiers: Vec<(String, RawSpan, bool)>,
}

pub fn analyze_file(
    allocator: &Allocator,
    rel_path: &str,
    source: &str,
    rules: &[Box<dyn EngineRule>],
    collect_imports: bool,
) -> FileOutput {
    with_context(allocator, rel_path, source, |ctx: &FileContext| {
        let mut diagnostics = Vec::new();
        for rule in rules {
            for raw in rule.check(ctx) {
                diagnostics.push(shape_diag(rel_path, ctx, raw));
            }
        }
        let specifiers = if collect_imports {
            crate::arch::collect_specifiers(ctx)
        } else {
            Vec::new()
        };
        FileOutput {
            diagnostics,
            specifiers,
        }
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
        path_events: raw.path_events,
    }
}
