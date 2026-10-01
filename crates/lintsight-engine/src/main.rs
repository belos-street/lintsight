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
//! T2.1 范围：协议联通 + no-eval 联通验证规则；T2.2 semantic/CFG 消费层、T2.3 taint 竖切随后。

mod analyze;
mod protocol;

use std::io::{self, Read};

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

    let allocator = oxc_allocator::Allocator::default();
    let mut diagnostics = Vec::new();
    let mut scanned = 0usize;

    for file in &input.files {
        let abs = if file.starts_with('/') {
            std::path::PathBuf::from(file)
        } else {
            root.join(file)
        };
        let Ok(source) = std::fs::read_to_string(&abs) else {
            continue; // 读不到的文件跳过（Bun 侧已做过存在性筛选）
        };
        let rel = abs
            .strip_prefix(&root)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| file.clone());
        let analyzed = analyze::analyze_file(&allocator, &rel, &source);
        diagnostics.extend(analyzed);
        scanned += 1;
    }

    for d in &diagnostics {
        protocol::emit_line(d);
    }
    let summary = protocol::Summary {
        kind: "summary",
        files: scanned,
        rules: vec!["lintsight-engine/no-eval".into()],
    };
    protocol::emit_line(&summary);
}
