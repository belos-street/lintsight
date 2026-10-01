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

mod analyze;
mod context;
mod protocol;
mod rules;
mod taint;

use std::io::{self, Read};

use oxc_allocator::Allocator;

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

    let rules = rules::registry();
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
        // 内存纪律（T2.2）：每文件独立 arena，analyze_file 返回即 drop——
        // 整批文件绝不共享 arena，否则峰值 = 全批 AST 之和
        let allocator = Allocator::default();
        let analyzed = analyze::analyze_file(&allocator, &rel, &source, &rules);
        diagnostics.extend(analyzed);
        scanned += 1;
        // allocator、source 在此 drop
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
