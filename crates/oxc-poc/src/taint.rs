//! spike ⑤：taint 竖切预演（M2 T2.0 门禁任务）。
//!
//! 最小过程内污点传播模型，验证「沿 CFG worklist 传播」的可行性：
//! - source：函数参数（FormalParameter，保守近似外部输入）+ `fs.readdirSync` 调用结果
//! - sanitizer：`path.basename`（剥离目录穿越的标准清洗）
//! - sink：`fs.readFileSync / readFile / writeFileSync / readdirSync` 第一参数被污染
//! - propagation：`path.join` 返回值、直接赋值（`const y = x` / `y = x`）
//! - 传播载体：CFG 块前向 worklist，块内 AST 节点按构建序（≈源码序）处理，
//!   回边（循环）由不动点迭代自然收敛（污染集单调只增）
//!
//! M1 铁律 2 在 Rust 轨道的对应物：本模块是 API 预演，正式实现走引擎 IR 面（design-m2）。
//! API 认知修正（0.150 实测）：`BindingPattern` 本身是 enum（BindingIdentifier/ObjectPattern/
//! ArrayPattern/…变体），无 BindingPatternKind 包装层。

use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    path::Path,
};

use oxc_allocator::Allocator;
use oxc_ast::{
    ast::{AssignmentTarget, BindingPattern, CallExpression, Expression},
    AstKind,
};
use oxc_cfg::BlockNodeId;
use oxc_semantic::Semantic;
use oxc_span::{GetSpan, Span};
use oxc_syntax::{node::NodeId, symbol::SymbolId};

use crate::{build_semantic, parse_file};

// readdirSync 是 source 函数（不是 sink）——sink 只放「写入/读出文件内容」的 API
const SINK_FUNCS: &[&str] = &["readFileSync", "readFile", "writeFileSync"];

#[derive(Debug, Clone, Copy)]
pub struct SinkHit {
    pub offset: u32,
    pub func: &'static str,
}

pub struct TaintResult {
    pub source_count: usize,
    pub sink_hits: Vec<SinkHit>,
    pub iterations: usize,
}

/// 污染状态：按块入口的污染符号集（单调只增 → 不动点必收敛）
type TaintState = BTreeSet<SymbolId>;

struct Analyzer<'a> {
    semantic: &'a Semantic<'a>,
    ref2sym: HashMap<u32, SymbolId>,
    block_nodes: BTreeMap<u32, Vec<u32>>,
    source_symbols: BTreeSet<SymbolId>,
    sinks: Vec<SinkHit>,
}

impl<'a> Analyzer<'a> {
    fn new(semantic: &'a Semantic<'a>) -> Self {
        let scoping = semantic.scoping();
        let nodes = semantic.nodes();
        let cfg = semantic.cfg().expect("CFG 未构建");

        // ReferenceId → SymbolId 反向表（symbol_ids 可全量遍历，spike ① 已确认）
        let mut ref2sym: HashMap<u32, SymbolId> = HashMap::new();
        for sid in scoping.symbol_ids() {
            for rid in scoping.get_resolved_reference_ids(sid) {
                ref2sym.insert(rid.index() as u32, sid);
            }
        }

        // AST 节点按所属 CFG 块分组（NodeId 递增 ≈ 源码序）+ source 收集（函数参数）
        let mut block_nodes: BTreeMap<u32, Vec<u32>> = BTreeMap::new();
        let mut source_symbols: BTreeSet<SymbolId> = BTreeSet::new();
        for (node_id, node) in nodes.iter_enumerated() {
            let block = nodes.cfg_id(node_id);
            block_nodes
                .entry(block.index() as u32)
                .or_default()
                .push(node_id.index() as u32);
            if let AstKind::FormalParameter(fp) = node.kind() {
                if let BindingPattern::BindingIdentifier(bi) = &fp.pattern {
                    source_symbols.insert(bi.symbol_id());
                }
            }
        }

        Self { semantic, ref2sym, block_nodes, source_symbols, sinks: Vec::new() }
    }

    fn sym_of_ref(&self, rid: u32) -> Option<SymbolId> {
        self.ref2sym.get(&rid).copied()
    }

    /// 表达式临时污染判定（1~2 层嵌套足够 spike 验证）
    fn expr_taints(&self, expr: &Expression, state: &TaintState) -> bool {
        match expr {
            Expression::Identifier(ident) => self
                .sym_of_ref(ident.reference_id().index() as u32)
                .is_some_and(|sid| state.contains(&sid)),
            Expression::CallExpression(call) => match member_name(call) {
                ("path", "join") => call
                    .arguments
                    .iter()
                    .any(|a| a.as_expression().is_some_and(|e| self.expr_taints(e, state))),
                ("path", "basename") => false, // sanitizer：basename 剥离目录穿越
                ("fs", "readdirSync") => true, // source：readdir 结果 = 外部可控文件名
                _ => false,
            },
            _ => false,
        }
    }

    fn process_node(&mut self, node_id: u32, state: &mut TaintState) {
        let node = self.semantic.nodes().get_node(NodeId::new(node_id as usize));
        match node.kind() {
            AstKind::VariableDeclarator(vd) => {
                if let BindingPattern::BindingIdentifier(bi) = &vd.id {
                    let target = bi.symbol_id();
                    let t = vd.init.as_ref().is_some_and(|init| self.expr_taints(init, state));
                    if std::env::var("TAINT_DEBUG").is_ok() {
                        let name = self.semantic.scoping().symbol_name(target).to_string();
                        eprintln!("[dbg] declarator {name} taint={t} state={state:?}");
                    }
                    if t {
                        state.insert(target);
                    }
                }
            }
            AstKind::AssignmentExpression(assign) => {
                if let AssignmentTarget::AssignmentTargetIdentifier(ident) = &assign.left {
                    if let Some(sid) = self.sym_of_ref(ident.reference_id().index() as u32) {
                        if self.expr_taints(&assign.right, state) {
                            state.insert(sid);
                        }
                    }
                }
            }
            AstKind::CallExpression(call) => {
                let (obj, func) = member_name(call);
                if obj == "fs" && SINK_FUNCS.contains(&func) {
                    if let Some(first) = call.arguments.first() {
                        if first.as_expression().is_some_and(|e| self.expr_taints(e, state)) {
                            // 回边不动点会重复进入块 → 按 offset 去重
                            let offset = call.span().start;
                            if !self.sinks.iter().any(|h| h.offset == offset) {
                                self.sinks.push(SinkHit {
                                    offset,
                                    func: SINK_FUNCS.iter().find(|f| **f == func).unwrap(),
                                });
                            }
                        }
                    }
                }
            }
            // for (const f of tainted) → 迭代变量继承污染（for-of 是 readdir 消费的主形态）
            AstKind::ForOfStatement(fo) => {
                if self.expr_taints(&fo.right, state) {
                    if let oxc_ast::ast::ForStatementLeft::VariableDeclaration(vd) = &fo.left {
                        for decl in &vd.declarations {
                            if let BindingPattern::BindingIdentifier(bi) = &decl.id {
                                state.insert(bi.symbol_id());
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }

    fn run_worklist(&mut self) -> usize {
        let cfg = self.semantic.cfg().expect("CFG 未构建");
        let graph = cfg.graph();
        // 初始污染：全部 source 符号预置到每个块入口（保守近似——参数 symbol 只会被
        // 其函数体内的引用解析到，跨函数假阳性被作用域解析天然抑制）
        let mut in_state: HashMap<u32, TaintState> = HashMap::new();
        for blk in 0..cfg.basic_blocks.len() as u32 {
            in_state.insert(blk, self.source_symbols.clone());
        }
        let mut out_state: HashMap<u32, TaintState> = HashMap::new();
        let mut worklist: Vec<u32> = (0..cfg.basic_blocks.len() as u32).collect();
        let mut iterations = 0usize;
        let max_iters = 64 * cfg.basic_blocks.len().max(1);

        while let Some(block) = worklist.pop() {
            iterations += 1;
            if iterations > max_iters {
                eprintln!("taint: 不动点迭代超限（异常，报告中标注）");
                break;
            }
            let mut state = in_state.get(&block).cloned().unwrap_or_default();
            let node_ids = self.block_nodes.get(&block).cloned().unwrap_or_default();
            for nid in node_ids {
                self.process_node(nid, &mut state);
            }

            // out 扩大才向后继传播（污染集单调只增 → 收敛保证）
            let propagated =
                out_state.get(&block).is_none_or(|old| !state.is_subset(old));
            out_state.insert(block, state.clone());
            if propagated {
                let bnode = BlockNodeId::new(block as usize);
                for succ in
                    graph.neighbors_directed(bnode, oxc_cfg::graph::Direction::Outgoing)
                {
                    let entry = in_state.entry(succ.index() as u32).or_default();
                    let before = entry.len();
                    entry.extend(state.iter().copied());
                    if entry.len() != before {
                        worklist.push(succ.index() as u32);
                    }
                }
            }
        }
        iterations
    }
}

pub fn run(path: &Path) {
    let source = std::fs::read_to_string(path).expect("read file");
    // 行号表：offset → (line, column) 1-based
    let mut line_starts: Vec<u32> = vec![0];
    for (i, b) in source.bytes().enumerate() {
        if b == b'\n' {
            line_starts.push(i as u32 + 1);
        }
    }
    let to_line_col = |offset: u32| -> (u32, u32) {
        let line = line_starts.partition_point(|&s| s <= offset) as u32;
        (line, offset - line_starts[(line - 1) as usize] + 1)
    };

    let allocator = Allocator::default();
    let program = parse_file(&allocator, path, &source);
    let semantic = build_semantic(&program);
    let cfg = semantic.cfg().expect("CFG 未构建");
    let (blocks, edges) = (cfg.basic_blocks.len(), cfg.graph().edge_count());

    let mut analyzer = Analyzer::new(&semantic);
    let iterations = analyzer.run_worklist();
    println!("== taint 预演: {} ==", path.display());
    println!(
        "   blocks={} edges={} sources={} worklist 迭代={} 轮收敛",
        blocks, edges, analyzer.source_symbols.len(), iterations
    );
    for (i, hit) in analyzer.sinks.iter().enumerate() {
        let (line, col) = to_line_col(hit.offset);
        println!(
            "   [sink #{}] {}:{}:{}  via fs.{}",
            i + 1,
            path.display(),
            line,
            col,
            hit.func
        );
    }
    // 注意：不动点迭代会重复访问块 → sinks 已按 offset 去重
    if analyzer.sinks.is_empty() {
        println!("   [sink] 无命中（sanitizer 生效或无污点流）");
    }
}

fn member_name<'a>(call: &'a CallExpression<'a>) -> (&'a str, &'a str) {
    const UNKNOWN: (&str, &str) = ("", "");
    let Expression::StaticMemberExpression(sme) = &call.callee else {
        return UNKNOWN;
    };
    let prop = sme.property.name.as_str();
    match &sme.object {
        Expression::Identifier(ident) => (ident.name.as_str(), prop),
        _ => UNKNOWN,
    }
}
