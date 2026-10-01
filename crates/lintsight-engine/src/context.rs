//! L1/L2 消费层（design-m2 §4.1 / T2.2）：semantic/CFG 查询面封装。
//!
//! `FileContext` = Rust 轨道规则的引擎 IR API 面：规则只经由它消费 AST/作用域/CFG，
//! 不直接触碰 parser 生命周期（铁律 2 的 Rust 轨道对应物——底层 oxc 版本升级只改本模块）。
//!
//! 内存纪律（T2.2 硬约束）：调用方保证每个文件一个 `Allocator`，`FileContext`
//! 随文件作用域 drop——峰值 ≈ 最大单文件，与批大小无关（spike ① 实测 1.1KB/LOC）。

use std::collections::HashMap;

use oxc_allocator::Allocator;
use oxc_ast::AstKind;
use oxc_semantic::{Semantic, SemanticBuilder};
use oxc_span::{SourceType, Span};
use oxc_syntax::{node::NodeId, reference::ReferenceId, symbol::SymbolId};

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

// L2 查询面（sym_of_ref/block_nodes/kind_of/source_text…）是 T2.3 taint worklist 的
// 消费 API，本切片先落位——binary crate 里 pub 也会报 dead_code，此处显式豁免
#[allow(dead_code)]
pub struct FileContext<'a> {
    rel_path: String,
    source: &'a str,
    semantic: Semantic<'a>,
    line_map: LineMap,
    /// ReferenceId → SymbolId 反向表（spike ⑤：symbol_ids × resolved_reference_ids 全量展开）
    ref2sym: HashMap<u32, SymbolId>,
    /// AST 节点按所属 CFG 块分组（NodeId 递增 ≈ 源码序；taint worklist 的块内遍历序）
    block_nodes: Vec<Vec<u32>>,
}

/// scope-and-run（oxc 惯用 arena 模式）：Program/Semantic/FileContext 都活在本函数
/// 作用域内，`f` 返回即全部释放——caller 只拿到 arena 无关的结果 T。
pub fn with_context<'a, T>(
    allocator: &'a Allocator,
    rel_path: &str,
    source: &'a str,
    f: impl FnOnce(&FileContext) -> T,
) -> T {
    let source_type = SourceType::from_path(rel_path).unwrap_or(SourceType::mjs());
    let ret = oxc_parser::Parser::new(allocator, source, source_type).parse();
    // 0.150 行为（spike ①）：`new()` 默认轻量 Scoping-only——深度引擎需要
    // AST 节点随机访问 + CFG，等价配置 = with_build_nodes(true) + with_cfg(true)
    let program = ret.program;
    let semantic = SemanticBuilder::new()
        .with_build_nodes(true)
        .with_cfg(true)
        .build(&program)
        .semantic;

    let line_map = LineMap::new(source);

    let scoping = semantic.scoping();
    let mut ref2sym: HashMap<u32, SymbolId> = HashMap::new();
    for sid in scoping.symbol_ids() {
        for rid in scoping.get_resolved_reference_ids(sid) {
            ref2sym.insert(rid.index() as u32, sid);
        }
    }

    let n_blocks = semantic
        .cfg()
        .map(|cfg| cfg.basic_blocks.len())
        .unwrap_or(0);
    let mut block_nodes: Vec<Vec<u32>> = vec![Vec::new(); n_blocks];
    for (node_id, _) in semantic.nodes().iter_enumerated() {
        let block = semantic.nodes().cfg_id(node_id);
        block_nodes[block.index()].push(node_id.index() as u32);
    }

    let ctx = FileContext {
        rel_path: rel_path.into(),
        source,
        semantic,
        line_map,
        ref2sym,
        block_nodes,
    };
    f(&ctx)
}

#[allow(dead_code)]
impl<'a> FileContext<'a> {
    pub fn source(&self) -> &'a str {
        self.source
    }

    pub fn semantic(&self) -> &Semantic<'a> {
        &self.semantic
    }

    pub fn line_col(&self, offset: u32) -> (u32, u32) {
        self.line_map.to_line_col(offset)
    }

    /// 引用 → 已解析符号（未解析引用返回 None，如全局）
    pub fn sym_of_ref(&self, rid: ReferenceId) -> Option<SymbolId> {
        self.ref2sym.get(&(rid.index() as u32)).copied()
    }

    /// AST 节点按 CFG 块分组；下标 = 块号，元素 = NodeId 的 index
    pub fn block_nodes(&self) -> &[Vec<u32>] {
        &self.block_nodes
    }

    /// 节点 index → AstKind（block_nodes 遍历的取回形态）
    pub fn kind_of(&self, node_idx: u32) -> AstKind<'a> {
        self.semantic
            .nodes()
            .get_node(NodeId::new(node_idx as usize))
            .kind()
    }

    /// span 对应源码文本切片（字节偏移，AST span 天然对齐 char boundary）
    pub fn source_text(&self, span: Span) -> &'a str {
        &self.source[span.start as usize..span.end as usize]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SNIPPET: &str = "const x = 1\nconsole.log(x)\nif (x > 0) {\n  console.log(x)\n}\n";

    #[test]
    fn line_map_1based_line_col() {
        let lm = LineMap::new(SNIPPET);
        // "const x = 1" = 11 chars + \n → line 2 起始 offset 12；line 3 起始 offset 27
        assert_eq!(lm.to_line_col(12), (2, 1));
        assert_eq!(lm.to_line_col(27), (3, 1));
        // 行内：line 2 的 'x'（log 的实参）offset 24 → (2, 13)
        assert_eq!(lm.to_line_col(24), (2, 13));
    }

    #[test]
    fn build_with_cfg_and_block_grouping() {
        let allocator = Allocator::default();
        with_context(&allocator, "a.ts", SNIPPET, |ctx| {
            // CFG 已构建（非默认 feature 的回归哨兵）
            let cfg = ctx.semantic().cfg().expect("cfg feature 未生效");
            assert!(cfg.basic_blocks.len() > 1, "if 分支应产生多块");
            // 分组完备：每个 AST 节点恰好落在一个块里
            let total: usize = ctx.block_nodes().iter().map(|b| b.len()).sum();
            assert_eq!(total, ctx.semantic().nodes().len());
        });
    }

    #[test]
    fn sym_of_ref_resolves_binding_reference() {
        let allocator = Allocator::default();
        with_context(&allocator, "a.ts", SNIPPET, |ctx| {
            // 找到 console.log(x) 的 IdentifierReference 引用 → 应解析到 x 的符号
            let mut found = false;
            for (_, node) in ctx.semantic().nodes().iter_enumerated() {
                if let AstKind::IdentifierReference(ident) = node.kind() {
                    if ident.name == "x" {
                        assert!(ctx.sym_of_ref(ident.reference_id()).is_some());
                        found = true;
                    }
                }
            }
            assert!(found, "fixture 中应有 x 的引用");
        });
    }

    #[test]
    fn source_text_slices_by_span() {
        let allocator = Allocator::default();
        with_context(&allocator, "a.ts", SNIPPET, |ctx| {
            assert_eq!(ctx.source_text(Span::new(0, 5)), "const");
        });
    }
}
