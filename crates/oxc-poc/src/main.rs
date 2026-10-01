//! spike ①：oxc crate 直连 PoC（oxc 0.150.0，对齐 oxlint 1.83.0）
//!
//! 验证目标（requirements §2.2~2.4 / oxc-crates.md spike 清单）：
//!   1. oxc_parser → oxc_semantic（scope/symbol/reference）→ oxc_cfg 直连链路
//!   2. 10 万行语料 parse+semantic 耗时与内存（对照 NFR-1：15 万 LOC/s）
//!   3. AstKind 覆盖度抽查（深度规则涉及的节点类型是否齐全）
//!
//! 用法：
//!   oxc-poc walk    <file>      # 单文件全链路：scope 树 / 符号表 / 引用 / CFG 统计 / DOT 导出
//!   oxc-poc bench   [n_funcs]   # 合成 10 万行语料跑 parse+semantic，报耗时与吞吐
//!   oxc-poc astkind <file> [..]  # AstKind 覆盖度抽查（对照规则相关节点清单）

use std::{
    collections::BTreeSet,
    env, fs,
    path::{Path, PathBuf},
    time::Instant,
};

use oxc_allocator::Allocator;
use oxc_cfg::{DisplayDot, EdgeType, graph::visit::EdgeRef};
use oxc_parser::Parser;
use oxc_semantic::{Semantic, SemanticBuilder};
use oxc_span::{SourceType, Span};

fn main() {
    let args: Vec<String> = env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("walk") => walk(Path::new(args.get(2).expect("usage: walk <file>"))),
        Some("bench") => {
            let n: usize = args.get(2).map(|s| s.parse().expect("n_funcs")).unwrap_or(4000);
            bench(n)
        }
        Some("astkind") => {
            for f in &args[2..] {
                astkind(Path::new(f))
            }
        }
        _ => {
            eprintln!("usage: oxc-poc <walk <file> | bench [n_funcs] | astkind <file>...>");
            std::process::exit(2)
        }
    }
}

fn parse_file<'a>(allocator: &'a Allocator, path: &Path, source: &'a str) -> oxc_ast::ast::Program<'a> {
    let source_type = SourceType::from_path(path)
        .unwrap_or_else(|e| panic!("cannot infer source type for {path:?}: {e:?}"));
    let ret = Parser::new(allocator, source, source_type).parse();
    if ret.fatal_error || ret.diagnostics.has_errors() {
        eprintln!("[warn] parse errors in {path:?}:");
        for e in ret.diagnostics.errors().take(3) {
            eprintln!("  - {e}");
        }
    }
    ret.program
}

fn build_semantic<'a>(program: &'a oxc_ast::ast::Program<'a>) -> Semantic<'a> {
    // 0.150.0 行为：`new()` 默认不构建 AstNodes（轻量 Scoping-only 模式）——
    // 深度引擎需要 AST 节点随机访问 + CFG，等价配置 = with_build_nodes(true) + with_cfg(true)
    let ret = SemanticBuilder::new()
        .with_build_nodes(true)
        .with_cfg(true)
        .build(program);
    if ret.diagnostics.has_errors() {
        eprintln!("[warn] semantic errors: {}", ret.diagnostics.errors().count());
    }
    ret.semantic
}

// ---------------------------------------------------------------- walk 模式

fn walk(path: &Path) {
    let source = fs::read_to_string(path).expect("read file");
    let allocator = Allocator::default();
    let program = parse_file(&allocator, path, &source);
    let semantic = build_semantic(&program);
    let scoping = semantic.scoping();

    println!("== file: {}  ({} bytes)", path.display(), source.len());
    println!("== source_type: {:?}", semantic.source_type());

    // ---- 1. scope 树 + 绑定
    println!("\n== scope tree (root + all scopes) ==");
    for scope_id in scoping.scope_descendants_from_root() {
        let depth = scoping.scope_ancestors(scope_id).count().saturating_sub(1);
        let parent = scoping
            .scope_parent_id(scope_id)
            .map(|p| format!("{p:?}"))
            .unwrap_or_else(|| "-".into());
        let flags = format!("{:?}", scoping.scope_flags(scope_id));
        let bindings: Vec<String> = scoping
            .get_bindings(scope_id)
            .iter()
            .map(|(ident, sid)| format!("{}(sym={}, refs={})", ident.as_str(), sid.index(), scoping.get_resolved_reference_ids(*sid).len()))
            .collect();
        let pad = " ".repeat(depth * 2);
        println!(
            "  {pad}{scope_id:?} parent={parent} flags={flags} bindings=[{}]",
            bindings.join(", "),
        );
    }

    // ---- 2. 符号表明细（declaration span + 已解析引用）
    println!("\n== symbols ==");
    for (scope_id, bindings) in scoping.iter_bindings() {
        for (ident, sid) in bindings.iter() {
            let span: Span = scoping.symbol_span(*sid);
            println!(
                "  {} :: {} @{}..{}  flags={:?}",
                format!("{scope_id:?}"),
                ident.as_str(),
                span.start,
                span.end,
                scoping.symbol_flags(*sid)
            );
        }
    }

    // ---- 3. 引用解析统计
    let mut total_refs = 0usize;
    for (_, bindings) in scoping.iter_bindings() {
        for (_, sid) in bindings.iter() {
            total_refs += scoping.get_resolved_reference_ids(*sid).len();
        }
    }
    let unresolved = scoping.root_unresolved_references();
    let unresolved_count: usize = unresolved.values().map(|ids| ids.len()).sum();
    println!("\n== references: resolved={total_refs} unresolved(global)={unresolved_count}");
    let mut globals: Vec<&str> = unresolved.keys().map(|i| i.as_str()).collect();
    globals.sort();
    println!("   globals: {}", globals.join(", "));

    // ---- 4. CFG 统计
    let cfg = semantic.cfg().expect("CFG not built (with_cfg(true) missing)");
    let n_blocks = cfg.basic_blocks.len();
    let graph = cfg.graph();
    let mut edge_counts: std::collections::BTreeMap<String, usize> = Default::default();
    let mut backedges: Vec<String> = Vec::new();
    for edge in graph.edge_references() {
        let t = format!("{:?}", edge.weight());
        if matches!(edge.weight(), EdgeType::Backedge) {
            backedges.push(format!("bb{} -> bb{}", edge.source().index(), edge.target().index()));
        }
        *edge_counts.entry(t).or_default() += 1;
    }
    let unreachable_blocks = cfg.basic_blocks.iter().filter(|b| b.is_unreachable()).count();
    println!("\n== CFG: basic_blocks={n_blocks} unreachable_blocks={unreachable_blocks}");
    for (t, c) in &edge_counts {
        println!("   edge {:?}: {}", t, c);
    }
    println!("   backedges (loop proof): {}", backedges.join(", "));

    // ---- 5. AST 节点 ↔ CFG 块映射（DFG 地基能力验证）
    let nodes = semantic.nodes();
    let mut cfg_blocks_touched: BTreeSet<u32> = BTreeSet::new();
    for (node_id, _) in nodes.iter_enumerated() {
        cfg_blocks_touched.insert(nodes.cfg_id(node_id).index() as u32);
    }
    println!(
        "== ast nodes: total={}  distinct cfg blocks referenced={}/{}  (cfg_id 桥 = DFG 挂载点)",
        nodes.len(),
        cfg_blocks_touched.len(),
        n_blocks
    );

    // ---- 6. DOT 导出
    let dot = cfg.display_dot();
    let out: PathBuf = path.with_extension("cfg.dot");
    fs::write(&out, &dot).expect("write dot");
    println!("== DOT written to {} ({} bytes)\n", out.display(), dot.len());

    astkind(path);
}

// ---------------------------------------------------------------- bench 模式

/// 生成 1 个合成函数（约 24 行，覆盖 if/for/while/switch/try/模板串/箭头函数）
fn gen_function(i: usize) -> String {
    format!(
        r#"export function fn_{i}(a: number, b: number): number {{
  let x = a + b
  if (x > 10) {{
    for (let i = 0; i < x; i++) {{
      if (i % 2 === 0) {{ x += i }} else {{ x -= 1 }}
    }}
  }} else {{
    while (x < 100) {{ x = x * 2 + 1 }}
  }}
  const log = (m: string) => console.log(`fn_{i}: ${{m}} ${{x}}`)
  try {{
    switch (x % 3) {{
      case 0: x = x + 1; break
      case 1: x = x - 1; break
      default: x = x * 2
    }}
    log('done')
  }} catch (e: unknown) {{
    console.error('failed', e)
  }}
  return x
}}
"#
    )
}

fn bench(n_funcs: usize) {
    let mut source = String::with_capacity(n_funcs * 700);
    for i in 0..n_funcs {
        source.push_str(&gen_function(i));
    }
    let loc = source.lines().count();
    println!("== bench: {n_funcs} functions, {loc} lines, {} bytes", source.len());

    let mut runs: Vec<(u128, u128)> = Vec::new(); // (parse_ms, semantic_ms)
    for run in 0..3 {
        let allocator = Allocator::default();
        let source_type = SourceType::mjs().with_typescript(true);
        let t0 = Instant::now();
        let ret = Parser::new(&allocator, &source, source_type).parse();
        let parse_ms = t0.elapsed().as_millis();
        assert!(
            !ret.diagnostics.has_errors() && !ret.fatal_error,
            "generated corpus must parse clean"
        );
        let t1 = Instant::now();
        let semantic = SemanticBuilder::new()
            .with_build_nodes(true)
            .with_cfg(true)
            .build(&ret.program)
            .semantic;
        let semantic_ms = t1.elapsed().as_millis();
        let cfg = semantic.cfg().unwrap();
        println!(
            "   run{}: parse={parse_ms}ms  semantic+cfg={semantic_ms}ms  blocks={}",
            run + 1,
            cfg.basic_blocks.len()
        );
        runs.push((parse_ms, semantic_ms));
    }
    let best = runs.iter().map(|(p, s)| p + s).min().unwrap();
    let loc_per_s = (loc as u128) * 1000 / best.max(1);
    println!("== best total={best}ms  throughput={loc_per_s} LOC/s  (budget: 150000 LOC/s)");
    println!("== verdict: {}", if loc_per_s >= 150_000 { "PASS" } else { "REVIEW" });

    // 对照组：oxlint 全量配置（new_linter = nodes+cfg+class_table+check_syntax_error）
    let allocator = Allocator::default();
    let source_type = SourceType::mjs().with_typescript(true);
    let ret = Parser::new(&allocator, &source, source_type).parse();
    let t = Instant::now();
    let semantic = SemanticBuilder::new_linter().build(&ret.program).semantic;
    let linter_ms = t.elapsed().as_millis();
    println!(
        "== 对照组 new_linter()（nodes+cfg+class_table+syntax-check）: {linter_ms}ms（blocks={}）",
        semantic.cfg().unwrap().basic_blocks.len()
    );
}

// ---------------------------------------------------------------- astkind 模式

/// 深度规则（taint/DFG/安全 P0）依赖的节点类型抽查清单（附录 A / P0 规则提案映射）
const RULE_RELEVANT: &[&str] = &[
    "CallExpression",
    "NewExpression",
    "StaticMemberExpression",
    "ComputedMemberExpression",
    "AssignmentExpression",
    "AwaitExpression",
    "YieldExpression",
    "TemplateLiteral",
    "TaggedTemplateExpression",
    "BinaryExpression",
    "LogicalExpression",
    "ConditionalExpression",
    "VariableDeclarator",
    "Function",
    "ArrowFunctionExpression",
    "CatchClause",
    "ThrowStatement",
    "TryStatement",
    "IfStatement",
    "ForStatement",
    "ForInStatement",
    "ForOfStatement",
    "WhileStatement",
    "ReturnStatement",
    "ImportDeclaration",
    "ImportExpression",
    "ExportNamedDeclaration",
    "RegExpLiteral",
    "IdentifierReference",
    "BindingIdentifier",
    "PropertyDefinition",
    "Class",
    "JSXOpeningElement",
    "ThisExpression",
];

fn astkind(path: &Path) {
    let source = fs::read_to_string(path).expect("read file");
    let allocator = Allocator::default();
    let program = parse_file(&allocator, path, &source);
    let semantic = build_semantic(&program);

    let mut seen: BTreeSet<String> = BTreeSet::new();
    for node in semantic.nodes().iter() {
        let dbg = format!("{:?}", node.kind());
        let name = dbg.split('(').next().unwrap_or("").to_string();
        seen.insert(name);
    }

    let missing: Vec<&&str> = RULE_RELEVANT.iter().filter(|k| !seen.contains(**k)).collect();
    println!("== astkind: {} ==", path.display());
    println!("   distinct kinds seen: {}", seen.len());
    println!("   rule-relevant checked: {}  missing in this file: {:?} (may be file-specific)", RULE_RELEVANT.len(), missing);
    println!("   kinds: {:?}\n", seen.iter().collect::<Vec<_>>());
}
