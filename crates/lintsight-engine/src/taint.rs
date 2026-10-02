//! taint 引擎（M2-DR2，spike ⑤ 模型产品化）：CFG 块前向 worklist + SymbolId 污染集。
//!
//! 污染集单调只增 → 不动点必收敛；回边（循环）由迭代自然处理，sink 按 span offset
//! 去重（spike ⑤ 教训 #3）。
//!
//! 表治理（M2-DR5）：source/propagator/sanitizer/sink 全部注册表驱动，
//! `TaintTables::validate` 做两两交叠校验（spike ⑤ 教训 #1：readdirSync 曾同时进
//! source/sink 表产生自指报告）；规则登记期调用，cargo test 锁定。
//!
//! v0 范围（no-path-traversal，CWE-22）：
//! - source：`fs.readdirSync` 结果（外部可控文件名清单）。函数参数不作为 source
//!   （spike ⑤ 的保守近似在真实项目会误报风暴，跨过程参数污点留给 M3）
//! - propagator：`path.join` 返回值、直接赋值、for-of 迭代变量（spike ⑤ 教训 #2）、
//!   索引访问 `files[i]`、模板串、字符串拼接
//! - sanitizer：`path.basename`（剥离目录成分；在污染实参上清洗时记 sanitizer 事件）
//! - sink：fs 读写内容 API 的第一参数
//!
//! 已知边界（v0 显式不做）：命名导入别名（`import { join } from 'path'`）、
//! 箭头函数参数污点、跨文件/跨过程传播（M3）、解构赋值。
//!
//! 证据链（design-m2 §4.2）：每个 sink 命中携带 pathEvents
//! （source → propagation* → [sanitizer] → sink），平台 AI 研判（FR-601）依赖。

use std::collections::{BTreeMap, BTreeSet};

use oxc_ast::ast::{
    AssignmentTarget, BindingPattern, CallExpression, Expression, ForStatementLeft,
};
use oxc_span::Span;
use oxc_syntax::symbol::SymbolId;

use crate::context::FileContext;
use crate::protocol::PathEvent;

/// 函数表条目：(命名空间对象, 方法名)，如 ("fs", "readdirSync")。按名字匹配——
/// 不解析 import 绑定（v0 边界，见模块文档）。
type FuncKey = (&'static str, &'static str);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventKind {
    Source,
    Propagation,
    Sanitizer,
    Sink,
}

impl EventKind {
    pub fn as_str(self) -> &'static str {
        match self {
            EventKind::Source => "source",
            EventKind::Propagation => "propagation",
            EventKind::Sanitizer => "sanitizer",
            EventKind::Sink => "sink",
        }
    }
}

fn event(kind: EventKind, key: (&str, &str), offset: u32) -> PathEvent {
    PathEvent {
        kind: kind.as_str(),
        node: format!("{}.{}", key.0, key.1),
        offset,
    }
}

/// 引擎函数表（M2-DR5 注册表）。字段顺序即事件链语义分层。
pub struct TaintTables {
    pub name: &'static str,
    /// 调用形态 source：`fs.readdirSync(...)` 返回值污染
    pub sources: &'static [FuncKey],
    /// 成员表达式形态 source（FR-303 后端扩展）：`req.query` / `req.body` 访问即污染；
    /// 同名调用形态（Hono `c.req.query()`）同样污染。匹配「链上相邻段对」
    pub member_sources: &'static [FuncKey],
    pub propagators: &'static [FuncKey],
    pub sanitizers: &'static [FuncKey],
    /// sink 的 (obj, func)：obj 为空串 = 裸标识符调用（如 `import { exec } from 'node:child_process'`）
    pub sinks: &'static [FuncKey],
}

impl TaintTables {
    /// 登记期交叠校验：五张表两两不得含相同 (obj, func)——自指传播/清洗即报告
    /// 的根源（spike ⑤ 教训 #1 制度化）。
    pub fn validate(&self) -> Result<(), String> {
        let tables = [
            ("sources", self.sources),
            ("member_sources", self.member_sources),
            ("propagators", self.propagators),
            ("sanitizers", self.sanitizers),
            ("sinks", self.sinks),
        ];
        for i in 0..tables.len() {
            for j in (i + 1)..tables.len() {
                for a in tables[i].1 {
                    if tables[j].1.contains(a) {
                        return Err(format!(
                            "taint tables [{}] ∩ [{}] 交叠：{}::{}（{} 表）",
                            tables[i].0,
                            tables[j].0,
                            a.0,
                            a.1,
                            self.name
                        ));
                    }
                }
            }
        }
        Ok(())
    }

    /// 按值查表（arena 生命周期键 vs 'static 表条目）
    fn member_kind(&self, key: (&str, &str)) -> Option<EventKind> {
        let in_table = |t: &'static [FuncKey]| t.iter().any(|k| k.0 == key.0 && k.1 == key.1);
        if in_table(self.sources) || in_table(self.member_sources) {
            Some(EventKind::Source)
        } else if in_table(self.propagators) {
            Some(EventKind::Propagation)
        } else if in_table(self.sanitizers) {
            Some(EventKind::Sanitizer)
        } else if in_table(self.sinks) {
            Some(EventKind::Sink)
        } else {
            None
        }
    }

    fn is_sink(&self, key: (&str, &str)) -> bool {
        self.sinks.iter().any(|k| k.0 == key.0 && k.1 == key.1)
    }
}

pub struct SinkHit {
    pub span: Span,
    /// sink 函数（owned，arena 释放后仍存活）
    pub func: (String, String),
    /// 证据链：source → propagation* → [sanitizer] → sink
    pub events: Vec<PathEvent>,
}

/// 块入口污染状态（单调只增 → 收敛保证）。prov 记录每个污染符号的证据链，
/// 合并取先到（worklist 顺序确定 → 结果确定，M1-DR4 精神）。
#[derive(Default, Clone)]
struct BlockState {
    syms: BTreeSet<SymbolId>,
    prov: BTreeMap<u32, Vec<PathEvent>>,
}

impl BlockState {
    fn taint(&mut self, sym: SymbolId, chain: Vec<PathEvent>) {
        self.prov.entry(sym.index() as u32).or_insert(chain);
        self.syms.insert(sym);
    }

    fn chain_of(&self, sym: SymbolId) -> Option<&Vec<PathEvent>> {
        self.prov.get(&(sym.index() as u32))
    }
}

/// 调用/成员链的 (命名空间, 末段名)：取链上最后两段。
/// `fs.readFileSync` → ("fs","readFileSync")；`c.req.query` → ("req","query")；
/// 裸标识符 `exec(...)` → ("","exec")（obj 空串约定 = 无命名空间形态）。
fn member_name<'a>(expr: &'a Expression<'a>) -> (&'a str, &'a str) {
    let mut cur = expr;
    loop {
        match cur {
            Expression::StaticMemberExpression(m) => {
                // 链末段 (m.object 的末段名, m.property)
                let obj = match &m.object {
                    Expression::Identifier(i) => i.name.as_str(),
                    Expression::StaticMemberExpression(inner) => inner.property.name.as_str(),
                    _ => "",
                };
                return (obj, m.property.name.as_str());
            }
            Expression::Identifier(i) => return ("", i.name.as_str()),
            // 继续剥 Parenthesized/TS 断言等包装（0.150 无该 Expression 变体则自然落空）
            _ => return ("", ""),
        }
    }
}

pub fn run(ctx: &FileContext, tables: &TaintTables) -> Vec<SinkHit> {
    tables
        .validate()
        .expect("taint tables 交叠（登记期必须拦截）");

    let cfg = ctx.semantic().cfg().expect("CFG 未构建");
    let mut analyzer = Analyzer {
        ctx,
        tables,
        hits: Vec::new(),
    };

    let mut in_state: BTreeMap<u32, BlockState> = BTreeMap::new();
    let mut out_state: BTreeMap<u32, BlockState> = BTreeMap::new();
    let mut worklist: Vec<u32> = (0..cfg.basic_blocks.len() as u32).collect();
    let mut iterations = 0usize;
    let max_iters = 64 * cfg.basic_blocks.len().max(1);

    while let Some(block) = worklist.pop() {
        iterations += 1;
        if iterations > max_iters {
            // 不动点超限 = 状态机异常；宁可漏报不可死循环（fail-safe，对齐 M2-DR3 精神）
            break;
        }
        let mut state = in_state.remove(&block).unwrap_or_default();
        for nid in ctx.block_nodes().get(block as usize).into_iter().flatten() {
            analyzer.process_node(*nid, &mut state);
        }

        // out 扩大才向后继传播
        let propagated = out_state
            .get(&block)
            .is_none_or(|old| !state.syms.is_subset(&old.syms));
        out_state.insert(block, state.clone());
        if propagated {
            let bnode = oxc_cfg::BlockNodeId::new(block as usize);
            for succ in cfg
                .graph()
                .neighbors_directed(bnode, oxc_cfg::graph::Direction::Outgoing)
            {
                let entry = in_state.entry(succ.index() as u32).or_default();
                let before = entry.syms.len();
                for sym in &state.syms {
                    entry.syms.insert(*sym);
                    if let Some(chain) = state.chain_of(*sym) {
                        entry
                            .prov
                            .entry(sym.index() as u32)
                            .or_insert_with(|| chain.clone());
                    }
                }
                if entry.syms.len() != before {
                    worklist.push(succ.index() as u32);
                }
            }
        }
    }

    analyzer.hits
}

struct Analyzer<'a, 't> {
    ctx: &'a FileContext<'a>,
    tables: &'t TaintTables,
    hits: Vec<SinkHit>,
}

impl<'a, 't> Analyzer<'a, 't> {
    fn process_node(&mut self, node_idx: u32, state: &mut BlockState) {
        match self.kind(node_idx) {
            // const x = <tainted>
            oxc_ast::AstKind::VariableDeclarator(vd) => {
                if let BindingPattern::BindingIdentifier(bi) = &vd.id {
                    if let Some(init) = &vd.init {
                        let mut extra = Vec::new();
                        if let Some(chain) = self.eval(init, state, &mut extra) {
                            state.taint(bi.symbol_id(), chain);
                        }
                    }
                }
            }
            // x = <tainted>
            oxc_ast::AstKind::AssignmentExpression(assign) => {
                if let AssignmentTarget::AssignmentTargetIdentifier(ident) = &assign.left {
                    if let Some(sid) = self.sym_of_ref(ident.reference_id()) {
                        let mut extra = Vec::new();
                        if let Some(chain) = self.eval(&assign.right, state, &mut extra) {
                            state.taint(sid, chain);
                        }
                    }
                }
            }
            // sink 检查：fs.readFileSync(<tainted>) 等
            oxc_ast::AstKind::CallExpression(call) => {
                let key = member_name(&call.callee);
                if self.tables.is_sink(key) {
                    if let Some(arg) = call.arguments.first() {
                        let mut extra = Vec::new();
                        if let Some(chain) = arg
                            .as_expression()
                            .and_then(|e| self.eval(e, state, &mut extra))
                        {
                            // 证据链 = 污染链 + 混合实参中「已尝试清洗」的痕迹 + sink
                            let mut full = chain;
                            full.extend(extra);
                            full.push(event(EventKind::Sink, key, call.span.start));
                            let span: Span = call.span;
                            // 回边不动点会重复进块 → 按 offset 去重（spike ⑤ 教训 #3）
                            if !self.hits.iter().any(|h| h.span.start == span.start) {
                                self.hits.push(SinkHit {
                                    span,
                                    func: (key.0.to_string(), key.1.to_string()),
                                    events: full,
                                });
                            }
                        }
                    }
                }
            }
            // for (const f of <tainted>) → 迭代变量继承污染（readdir 消费主形态）
            oxc_ast::AstKind::ForOfStatement(fo) => {
                let mut extra = Vec::new();
                if let Some(chain) = self.eval(&fo.right, state, &mut extra) {
                    if let ForStatementLeft::VariableDeclaration(vd) = &fo.left {
                        for decl in &vd.declarations {
                            if let BindingPattern::BindingIdentifier(bi) = &decl.id {
                                state.taint(bi.symbol_id(), chain.clone());
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }

    /// 表达式临时污染判定：Some(chain) = 污染（chain 为到该表达式的证据链）。
    /// sanitizer 事件即使最终清洗（返回 None）也会记入 events——混合实参
    /// `join(tainted, basename(x))` 的报告链能看到「已尝试清洗」的痕迹。
    fn eval(
        &self,
        expr: &Expression,
        state: &BlockState,
        events: &mut Vec<PathEvent>,
    ) -> Option<Vec<PathEvent>> {
        match expr {
            Expression::Identifier(ident) => {
                let sid = self.sym_of_ref(ident.reference_id())?;
                state.chain_of(sid).cloned().or_else(|| {
                    // 污染但无链（跨块合并裁剪）——占位链保证报告仍可发
                    state.syms.contains(&sid).then(Vec::new)
                })
            }
            Expression::CallExpression(call) => {
                let key = member_name(&call.callee);
                match self.tables.member_kind(key) {
                    Some(EventKind::Source) => {
                        // source 事件只进返回链（链头）
                        Some(vec![event(EventKind::Source, key, call.span.start)])
                    }
                    Some(EventKind::Propagation) => {
                        let mut merged: Option<Vec<PathEvent>> = None;
                        for a in &call.arguments {
                            if let Some(e) = a.as_expression() {
                                if let Some(chain) = self.eval(e, state, events) {
                                    merged.get_or_insert_with(Vec::new).extend(chain);
                                }
                            }
                        }
                        // 传播事件只进返回链（不写共享 events——sink 侧合并会重复）
                        merged.map(|mut chain| {
                            chain.push(event(EventKind::Propagation, key, call.span.start));
                            chain
                        })
                    }
                    Some(EventKind::Sanitizer) => {
                        // 实参污染才记 sanitizer 事件（清洗动作发生在污染流上）
                        let tainted = call.arguments.first().and_then(|a| {
                            a.as_expression().and_then(|e| {
                                let mut probe = Vec::new();
                                let r = self.eval(e, state, &mut probe);
                                if r.is_some() {
                                    events.push(event(EventKind::Sanitizer, key, call.span.start));
                                }
                                r
                            })
                        });
                        let _ = tainted; // basename 结果恒洁净
                        None
                    }
                    _ => None,
                }
            }
            // 成员表达式形态 source（FR-303 后端扩展）：`req.query` / `req.body` 访问即污染。
            // 链上任意相邻段对命中即算（req.query.id → (req,query) ✓，(query,name) ✗ 不影响）
            Expression::StaticMemberExpression(_) => {
                let mut pairs: Vec<(&str, &str)> = Vec::new();
                let mut cur = expr;
                while let Expression::StaticMemberExpression(m) = cur {
                    match &m.object {
                        Expression::Identifier(i) => {
                            pairs.push((i.name.as_str(), m.property.name.as_str()))
                        }
                        Expression::StaticMemberExpression(inner) => pairs.push((
                            inner.property.name.as_str(),
                            m.property.name.as_str(),
                        )),
                        _ => {}
                    }
                    cur = &m.object;
                }
                for pair in &pairs {
                    if self.tables.member_kind(*pair) == Some(EventKind::Source) {
                        return Some(vec![event(
                            EventKind::Source,
                            *pair,
                            oxc_span::GetSpan::span(expr).start,
                        )]);
                    }
                }
                None
            }
            // files[i]：索引访问继承容器污染
            Expression::ComputedMemberExpression(m) => self.eval(&m.object, state, events),
            // `${dir}/${f}`——模板串传播点记入证据链（平台研判依赖传播节点）
            Expression::TemplateLiteral(t) => {
                let mut merged: Option<Vec<PathEvent>> = None;
                for e in &t.expressions {
                    if let Some(chain) = self.eval(e, state, events) {
                        merged.get_or_insert_with(Vec::new).extend(chain);
                    }
                }
                merged.map(|mut chain| {
                    chain.push(PathEvent {
                        kind: "propagation",
                        node: "template-literal".into(),
                        offset: t.span.start,
                    });
                    chain
                })
            }
            // dir + '/' + f——字符串拼接传播点
            Expression::BinaryExpression(b) => {
                let l = self.eval(&b.left, state, events);
                let r = self.eval(&b.right, state, events);
                let mut merged = match (l, r) {
                    (Some(mut a), Some(b)) => {
                        a.extend(b);
                        Some(a)
                    }
                    (Some(a), None) | (None, Some(a)) => Some(a),
                    (None, None) => None,
                };
                if let Some(chain) = &mut merged {
                    chain.push(PathEvent {
                        kind: "propagation",
                        node: "concat".into(),
                        offset: b.span.start,
                    });
                }
                merged
            }
            _ => None,
        }
    }

    fn kind(&self, node_idx: u32) -> oxc_ast::AstKind<'a> {
        self.ctx.kind_of(node_idx)
    }

    fn sym_of_ref(&self, rid: oxc_syntax::reference::ReferenceId) -> Option<SymbolId> {
        self.ctx.sym_of_ref(rid)
    }
}
