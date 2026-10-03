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
//! - source：`fs.readdirSync` 结果（外部可控文件名清单）+ 成员表达式形态（FR-303，
//!   `req.query` 等访问即污染）。函数参数不作为 source（spike ⑤ 的保守近似在真实
//!   项目会误报风暴，跨过程参数污点留给 M3）
//! - propagator：`path.join` 返回值、直接赋值、for-of 迭代变量（spike ⑤ 教训 #2）、
//!   索引访问 `files[i]`、模板串、字符串拼接、解构绑定、map 家族回调参数
//! - sanitizer：`path.basename`（剥离目录成分；在污染实参上清洗时记 sanitizer 事件）
//! - sink：fs 读写内容 API 的第一参数
//!
//! 已知边界（v0 补齐后）：default/namespace 导入别名归一（`import fs2 from 'fs'` →
//! 标准模块名）、解构传播（`const { a } = tainted` / `const [x] = tainted`）、
//! options 对象形态（`axios({ url: tainted })`）、map 家族回调参数污染（容器驱动：
//! `files.map(f => …)`，非 spike 式全参数 source）均已支持；仍不做：命名导入别名
//! （`import { join } from 'path'`，维持裸标识符 obj=""约定）、任意函数参数 source、
//! 跨文件/跨过程传播（M3）。
//!
//! 证据链（design-m2 §4.2）：每个 sink 命中携带 pathEvents
//! （source → propagation* → [sanitizer] → sink），平台 AI 研判（FR-601）依赖。

use std::collections::{BTreeMap, BTreeSet};

use oxc_ast::ast::{
    AssignmentTarget, BindingPattern, CallExpression, Expression, ForStatementLeft,
    ImportDeclarationSpecifier, ObjectPropertyKind,
};
use oxc_span::{GetSpan, Span};
use oxc_syntax::symbol::SymbolId;

use crate::context::FileContext;
use crate::protocol::PathEvent;

/// 函数表条目：(命名空间对象, 方法名)，如 ("fs", "readdirSync")。按名字匹配——
/// 不解析 import 绑定（v0 边界，见模块文档）。
type FuncKey = (&'static str, &'static str);

/// map 家族迭代方法：回调逐元素调用 → 回调参数继承容器污染（v0 补齐④，
/// for-of 迭代变量传播的函数式对应物；容器驱动，非 spike 式全参数 source）
const CALLBACK_ITER_METHODS: &[&str] = &["map", "forEach", "filter", "flatMap"];

/// options 对象的 URL 语义键：任一键的 value 污染 → 整个对象视为污染（v0 补齐③，
/// `axios({ url: tainted })` 形态）
const URL_KEYS: &[&str] = &["url", "uri", "baseURL", "hostname"];

/// 导入别名归一收录的标准模块（`node:` 前缀剥除后匹配；对齐 rules.rs 各函数表
/// 的 obj 名——fs/cp/child_process/axios/http/https/lodash/_/path）
const KNOWN_MODULES: &[&str] = &[
    "fs",
    "child_process",
    "axios",
    "http",
    "https",
    "lodash",
    "path",
];

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
    /// sink 检查的参数位（0-based）。多数规则 = 0（exec(cmd)/fetch(url)）；
    /// 原型污染 = 1（Object.assign(target, 源)——污染点在第二个参数）。每规则一个值。
    pub sink_arg_index: usize,
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
                            tables[i].0, tables[j].0, a.0, a.1, self.name
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
    let imports = collect_imports(ctx);
    let mut analyzer = Analyzer {
        ctx,
        tables,
        imports,
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

/// 导入别名表（v0 补齐②）：default/namespace 导入的 local 名 → 归一模块名
/// （`import fs2 from 'node:fs'` → fs2 → "fs"）。只收录函数表涉及的标准模块；
/// 命名导入维持裸标识符 obj=""约定，不在本表范围。
fn collect_imports<'a>(ctx: &FileContext<'a>) -> BTreeMap<&'a str, &'a str> {
    let mut map: BTreeMap<&'a str, &'a str> = BTreeMap::new();
    for (_, node) in ctx.semantic().nodes().iter_enumerated() {
        if let oxc_ast::AstKind::ImportDeclaration(imp) = node.kind() {
            let src = imp.source.value.as_str();
            let module = src.strip_prefix("node:").unwrap_or(src);
            if !KNOWN_MODULES.contains(&module) {
                continue;
            }
            if let Some(specifiers) = &imp.specifiers {
                for spec in specifiers {
                    let local = match spec {
                        ImportDeclarationSpecifier::ImportDefaultSpecifier(s) => &s.local,
                        ImportDeclarationSpecifier::ImportNamespaceSpecifier(s) => &s.local,
                        ImportDeclarationSpecifier::ImportSpecifier(_) => continue,
                    };
                    map.insert(local.name.as_str(), module);
                }
            }
        }
    }
    map
}

struct Analyzer<'a, 't> {
    ctx: &'a FileContext<'a>,
    tables: &'t TaintTables,
    /// 导入别名表（collect_imports）：local 名 → 归一模块名
    imports: BTreeMap<&'a str, &'a str>,
    hits: Vec<SinkHit>,
}

impl<'a, 't> Analyzer<'a, 't> {
    /// member 链 (obj, func)，obj 经导入别名表归一（v0 补齐②）：
    /// `import fs2 from 'fs'` 的 `fs2.readFileSync` → ("fs", "readFileSync")
    fn member_key(&self, expr: &'a Expression<'a>) -> (&'a str, &'a str) {
        let (obj, func) = member_name(expr);
        (self.imports.get(obj).copied().unwrap_or(obj), func)
    }

    /// 解构模式展开（v0 补齐①）：把污染传给模式绑定的全部符号——ObjectPattern
    /// 取 BindingProperty 的 value，ArrayPattern 取元素；默认值（AssignmentPattern）
    /// 与 rest 递归展开。chain 由调用方持引用，逐绑定 clone 分发。
    fn taint_binding_pattern(
        &self,
        pattern: &BindingPattern,
        chain: &[PathEvent],
        state: &mut BlockState,
    ) {
        match pattern {
            BindingPattern::BindingIdentifier(bi) => state.taint(bi.symbol_id(), chain.to_vec()),
            BindingPattern::ObjectPattern(obj) => {
                for prop in &obj.properties {
                    self.taint_binding_pattern(&prop.value, chain, state);
                }
                if let Some(rest) = &obj.rest {
                    self.taint_binding_pattern(&rest.argument, chain, state);
                }
            }
            BindingPattern::ArrayPattern(arr) => {
                for elem in arr.elements.iter().flatten() {
                    self.taint_binding_pattern(elem, chain, state);
                }
                if let Some(rest) = &arr.rest {
                    self.taint_binding_pattern(&rest.argument, chain, state);
                }
            }
            BindingPattern::AssignmentPattern(ap) => {
                self.taint_binding_pattern(&ap.left, chain, state);
            }
        }
    }

    fn process_node(&mut self, node_idx: u32, state: &mut BlockState) {
        match self.kind(node_idx) {
            // const x = <tainted> / const { a } = <tainted> / const [x] = <tainted>
            oxc_ast::AstKind::VariableDeclarator(vd) => {
                if let Some(init) = &vd.init {
                    let mut extra = Vec::new();
                    if let Some(chain) = self.eval(init, state, &mut extra) {
                        // v0 补齐①：BindingIdentifier 直绑 + 解构模式（Object/Array）展开
                        self.taint_binding_pattern(&vd.id, &chain, state);
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
            // sink 检查：fs.readFileSync(<tainted>) 等——参数位由表配置（sink_arg_index）
            oxc_ast::AstKind::CallExpression(call) => {
                let key = self.member_key(&call.callee);
                if self.tables.is_sink(key) {
                    let arg = call
                        .arguments
                        .get(self.tables.sink_arg_index)
                        .or_else(|| call.arguments.first());
                    let mut extra = Vec::new();
                    if let Some(chain) = arg
                        .and_then(|a| a.as_expression())
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
                // 回调迭代传播（v0 补齐④）：容器污染 → 回调参数继承污染
                // （files.map(f => …) 的 f）。函数体在 CFG 中是独立流（与调用点
                // 无边）→ 以派生态即时重放体内节点；sink 按 offset 去重保证
                // 重放与不动点重复进入不重复报告。
                if let Expression::StaticMemberExpression(m) = &call.callee {
                    if CALLBACK_ITER_METHODS.contains(&m.property.name.as_str()) {
                        let mut probe = Vec::new();
                        if let Some(chain) = self.eval(&m.object, state, &mut probe) {
                            if let Some(cb) = call.arguments.first().and_then(|a| a.as_expression())
                            {
                                self.replay_callback_body(cb, chain, state);
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

    /// 回调函数体重放（v0 补齐④）：容器污染 → 回调参数继承 → 以派生态重放体内
    /// 节点（体内传播/清洗/sink 全部复用 process_node 主逻辑）。体内对外层变量的
    /// 赋值（`files.forEach(f => { acc = f })`）随派生态回流外层。
    fn replay_callback_body(
        &mut self,
        cb: &'a Expression<'a>,
        chain: Vec<PathEvent>,
        state: &mut BlockState,
    ) {
        let (params, body_span) = match cb {
            Expression::ArrowFunctionExpression(arrow) => (&arrow.params, arrow.body.span()),
            Expression::FunctionExpression(func) => match &func.body {
                Some(body) => (&func.params, body.span),
                None => return,
            },
            _ => return,
        };
        // 参数继承（含解构参数/rest）：写入当前块状态——若 CFG 将函数体内联于
        // 同块则后续节点自然生效；独立流场景由下方派生态重放兜底
        for p in &params.items {
            self.taint_binding_pattern(&p.pattern, &chain, state);
        }
        if let Some(rest) = &params.rest {
            self.taint_binding_pattern(&rest.rest.argument, &chain, state);
        }
        // 派生态 = 外层污染 + 回调参数；重放函数体内全部节点（AST pre-order ≈ 源码序）
        let mut inner = state.clone();
        let body_ids: Vec<u32> = self
            .ctx
            .semantic()
            .nodes()
            .iter_enumerated()
            .filter(|(_, node)| {
                let s = node.kind().span();
                s.start >= body_span.start && s.end <= body_span.end
            })
            .map(|(nid, _)| nid.index() as u32)
            .collect();
        for nid in body_ids {
            self.process_node(nid, &mut inner);
        }
        // 回流：体内新污染的符号（外层闭包变量赋值形态）合并回外层状态
        for sym in &inner.syms {
            if !state.syms.contains(sym) {
                if let Some(ch) = inner.chain_of(*sym) {
                    state.taint(*sym, ch.clone());
                }
            }
        }
    }

    /// 表达式临时污染判定：Some(chain) = 污染（chain 为到该表达式的证据链）。
    /// sanitizer 事件即使最终清洗（返回 None）也会记入 events——混合实参
    /// `join(tainted, basename(x))` 的报告链能看到「已尝试清洗」的痕迹。
    fn eval(
        &self,
        expr: &'a Expression<'a>,
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
                let key = self.member_key(&call.callee);
                match self.tables.member_kind(key) {
                    Some(EventKind::Source) => {
                        // source 事件只进返回链（链头）。
                        // ⚠️ 不做「readdir 实参字面量 → 非 source」优化（M2.7 曾试，
                        // 已撤回）：uploads/tmp 等目录名常量但内容用户可控的真洞
                        // 会被漏报——静态上无法区分静态目录与动态内容目录，
                        // vulnCodeFixes 类误报是 readdir-source 保守近似的固有代价
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
                        Expression::StaticMemberExpression(inner) => {
                            pairs.push((inner.property.name.as_str(), m.property.name.as_str()))
                        }
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
            // options 对象形态（v0 补齐③，no-ssrf 复核清单项）：任一 URL 语义键
            // （url/uri/baseURL/hostname）的 value 污染 → 整个对象视为污染
            Expression::ObjectExpression(obj) => {
                for prop in &obj.properties {
                    let ObjectPropertyKind::ObjectProperty(p) = prop else {
                        continue;
                    };
                    let is_url_key = p
                        .key
                        .static_name()
                        .is_some_and(|name| URL_KEYS.contains(&name.as_ref()));
                    if is_url_key {
                        if let Some(mut chain) = self.eval(&p.value, state, events) {
                            chain.push(PathEvent {
                                kind: "propagation",
                                node: "options-object".into(),
                                offset: obj.span.start,
                            });
                            return Some(chain);
                        }
                    }
                }
                None
            }
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
