//! 协议层（design-m2 §4.2 v0）：输入/输出结构 + JSON Lines 输出 + fatal 退出。

use serde::Serialize;

#[derive(serde::Deserialize)]
pub struct EngineInput {
    pub files: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Span {
    pub offset: u32,
    pub length: u32,
    pub line: u32,
    pub column: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct Diagnostic {
    #[serde(rename = "type")]
    pub kind: &'static str, // 恒 "diagnostic"
    #[serde(rename = "ruleId")]
    pub rule_id: String,
    pub severity: &'static str,
    pub message: String,
    pub file: String,
    pub span: Span,
}

#[derive(Debug, Serialize)]
pub struct Summary {
    #[serde(rename = "type")]
    pub kind: &'static str, // 恒 "summary"
    pub files: usize,
    pub rules: Vec<String>,
}

pub fn emit_line<T: Serialize>(value: &T) {
    println!("{}", serde_json::to_string(value).expect("serialize"));
}

/// 协议级 fatal：stderr 错误 + exit 2（Bun 侧 fail-open 降级纯 M1 扫描）
pub fn fatal(message: &str) -> ! {
    eprintln!("lintsight-engine: {message}");
    std::process::exit(2);
}
