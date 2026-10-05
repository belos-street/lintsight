//! 循环依赖检测（FR-304②，`lintsight-engine/no-import-cycle`）：
//! 词法 import 图（与 arch-boundaries 同一解析口径）+ Tarjan SCC。
//!
//! 语义（v0）：
//! - 边 = 静态 import / export-from / 字符串字面量动态 import / require('x') 字面量；
//!   相对导入 + tsconfig paths 别名（FR-304① 嵌套感知）可解析的目标。裸说明符
//!   （npm 包）不解析——外部依赖的环不在工程治理范围（漏报不误报）
//! - 节点 = 扩展名剥离后的词法路径（importer 与 target 同口径归一；index 解析
//!   不 stat 文件系统，v0 不做——`./util` 与 `util.ts` 同键，`./util/index` 是
//!   独立键，可能漏报跨 index 形态的环，属已知边界）
//! - 报告粒度 = SCC：一个强连通分量（≥2 节点或自环）内，每个「有环内出边」的
//!   文件报 1 条（span = 其首条环内 import 字面量），message 携带确定性环链
//!   （从字典序最小成员出发、每次走字典序最小的环内后继，回到起点）
//!
//! 确定性（M1-DR4 精神）：邻接表 BTreeMap 排序 + SCC 成员排序 + 环链行走规则固定，
//! 同一图输入必产同一诊断序列。迭代式 Tarjan（显式栈）——大图防递归爆栈。

use std::collections::BTreeMap;

use oxc_span::Span;

/// 有向边表：from（文件相对路径，扩展名剥离）→ [(to, span)]，span = import 字面量。
/// 调用方（main）按文件序汇入；本模块再排序保证确定性。
pub type EdgeTable = BTreeMap<String, Vec<(String, Span)>>;

/// 扩展名剥离（节点身份归一）：`.ts/.tsx/.d.ts/.js/.jsx/.mjs/.cjs/.mts/.cts/.vue`
pub fn strip_extension(path: &str) -> String {
    for ext in [
        ".d.ts", ".tsx", ".ts", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".js", ".vue",
    ] {
        if let Some(stripped) = path.strip_suffix(ext) {
            return stripped.to_string();
        }
    }
    path.to_string()
}

#[derive(Debug)]
pub struct CycleDiag {
    pub file: String,
    pub span: Span,
    /// 环链：file → … → file（首尾同节点，节点为扩展名剥离后的路径）
    pub cycle: Vec<String>,
}

/// SCC 检测 + 诊断整形。edges 的键与 to 都应是扩展名剥离后的路径。
pub fn detect_cycles(edges: &EdgeTable) -> Vec<CycleDiag> {
    // —— 节点编号（BTreeMap 序 = 字典序，环链行走确定性依赖它） ——
    let mut ids: BTreeMap<&str, usize> = BTreeMap::new();
    let mut order: Vec<&str> = Vec::new();
    for (from, tos) in edges {
        if !ids.contains_key(from.as_str()) {
            ids.insert(from, order.len());
            order.push(from);
        }
        for (to, _) in tos {
            if !ids.contains_key(to.as_str()) {
                ids.insert(to, order.len());
                order.push(to);
            }
        }
    }

    // —— 邻接表（int 化 + 排序去重） ——
    let n = order.len();
    let mut adj: Vec<Vec<usize>> = vec![Vec::new(); n];
    for (from, tos) in edges {
        let f = ids[from.as_str()];
        let mut targets: Vec<usize> = tos
            .iter()
            .map(|(to, _)| ids[to.as_str()])
            .collect();
        targets.sort_unstable();
        targets.dedup();
        adj[f] = targets;
    }

    // —— 迭代式 Tarjan ——
    let sccs = tarjan(&adj, n);

    // —— 诊断整形：SCC ≥2（自环 size 1 但有自边）→ 每成员文件 1 条 ——
    let mut out = Vec::new();
    for scc in &sccs {
        let is_self_loop = scc.len() == 1 && adj[scc[0]].contains(&scc[0]);
        if scc.len() < 2 && !is_self_loop {
            continue;
        }
        let members: Vec<usize> = {
            let mut m = scc.clone();
            m.sort_unstable();
            m
        };
        let in_scc: Vec<bool> = {
            let mut v = vec![false; n];
            for &m in &members {
                v[m] = true;
            }
            v
        };
        // 环链：最小成员出发，每次走字典序最小环内后继，回到起点（成员互达保证可达）
        let cycle_chain = cycle_path(&members, &in_scc, &adj, &order);
        // 每个有环内出边的文件报首条环内 import（edges 向量已按源码序汇入）
        for &m in &members {
            let Some((_to, span)) = edges
                .get(order[m])
                .and_then(|tos| tos.iter().find(|(t, _)| in_scc[ids[t.as_str()]]))
            else {
                continue; // 自环节点自身（无出边记录形态）等边界：跳过
            };
            out.push(CycleDiag {
                file: order[m].to_string(),
                span: *span,
                cycle: cycle_chain.clone(),
            });
        }
    }
    // SCC 发现阶段序不稳定（邻接序已定但 tarjan 内部栈序）→ 按文件+span 终排序
    out.sort_by(|a, b| a.file.cmp(&b.file).then(a.span.start.cmp(&b.span.start)));
    out
}

/// 环链构造：从最小成员出发，重复走「字典序最小环内后继」直到回到起点。
/// 贪婪行走可能困在成员子环（不经过起点）——兜底回退为「成员排序 + 闭合」链
/// （SCC 定义保证成员互达，排序链仍是合法环表示）。
fn cycle_path(
    members: &[usize],
    in_scc: &[bool],
    adj: &[Vec<usize>],
    order: &[&str],
) -> Vec<String> {
    let start = members[0];
    let mut chain = vec![start];
    let mut cur = start;
    // 步数上界 = 成员数（自环 1 步，最长遍历全部成员）
    for _ in 0..=members.len() {
        let next = match adj[cur].iter().copied().find(|&t| in_scc[t]) {
            Some(t) => t,
            None => break,
        };
        chain.push(next);
        if next == start {
            return chain.iter().map(|&i| order[i].to_string()).collect();
        }
        cur = next;
    }
    // 兜底：成员排序闭合链（确定性不丢）
    let mut fallback: Vec<String> = members.iter().map(|&i| order[i].to_string()).collect();
    if let Some(first) = fallback.first().cloned() {
        fallback.push(first);
    }
    fallback
}

/// 迭代式 Tarjan SCC（adj 已排序；返回 SCC 列表，成员为节点编号）
fn tarjan(adj: &[Vec<usize>], n: usize) -> Vec<Vec<usize>> {
    #[derive(Clone, Copy)]
    struct Frame {
        v: usize,
        child_idx: usize,
    }
    let mut index_of = vec![usize::MAX; n];
    let mut low = vec![0usize; n];
    let mut on_stack = vec![false; n];
    let mut stack: Vec<usize> = Vec::new();
    let mut next_index = 0usize;
    let mut out: Vec<Vec<usize>> = Vec::new();

    for root in 0..n {
        if index_of[root] != usize::MAX {
            continue;
        }
        let mut call: Vec<Frame> = vec![Frame { v: root, child_idx: 0 }];
        while let Some(frame) = call.last_mut() {
            let v = frame.v;
            if frame.child_idx == 0 {
                index_of[v] = next_index;
                low[v] = next_index;
                next_index += 1;
                stack.push(v);
                on_stack[v] = true;
            }
            if let Some(&w) = adj[v].get(frame.child_idx) {
                frame.child_idx += 1;
                if index_of[w] == usize::MAX {
                    call.push(Frame { v: w, child_idx: 0 });
                } else if on_stack[w] {
                    low[v] = low[v].min(index_of[w]);
                }
            } else {
                // 所有后继处理完 → 回退，弹 SCC
                call.pop();
                if let Some(parent) = call.last_mut() {
                    low[parent.v] = low[parent.v].min(low[v]);
                }
                if low[v] == index_of[v] {
                    let mut scc = Vec::new();
                    while let Some(&w) = stack.last() {
                        stack.pop();
                        on_stack[w] = false;
                        scc.push(w);
                        if w == v {
                            break;
                        }
                    }
                    out.push(scc);
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn table(spec: &[(&str, &[&str])]) -> EdgeTable {
        let mut t: EdgeTable = BTreeMap::new();
        for (from, tos) in spec {
            t.insert(
                (*from).to_string(),
                tos.iter()
                    .map(|to| ((*to).to_string(), Span::new(0, 1)))
                    .collect(),
            );
        }
        t
    }

    #[test]
    fn detects_two_node_cycle() {
        let t = table(&[("src/a", &["src/b"]), ("src/b", &["src/a"])]);
        let diags = detect_cycles(&t);
        assert_eq!(diags.len(), 2, "环内每个文件报 1 条");
        assert_eq!(diags[0].file, "src/a");
        // 环链确定性：从字典序最小成员出发
        assert_eq!(diags[0].cycle, vec!["src/a", "src/b", "src/a"]);
    }

    #[test]
    fn acyclic_graph_clean() {
        // 菱形依赖非环
        let t = table(&[
            ("src/a", &["src/b", "src/c"]),
            ("src/b", &["src/d"]),
            ("src/c", &["src/d"]),
        ]);
        assert!(detect_cycles(&t).is_empty());
    }

    #[test]
    fn detects_self_loop() {
        let t = table(&[("src/a", &["src/a"])]);
        let diags = detect_cycles(&t);
        assert_eq!(diags.len(), 1);
        assert_eq!(diags[0].cycle, vec!["src/a", "src/a"]);
    }

    #[test]
    fn three_node_cycle_and_detached_edge() {
        let t = table(&[
            ("src/x", &["src/y"]),
            ("src/y", &["src/z"]),
            ("src/z", &["src/x"]),
            ("src/main", &["src/x"]), // 入边不参与环
        ]);
        let diags = detect_cycles(&t);
        assert_eq!(diags.len(), 3, "main 无环内出边，不报");
        assert!(diags.iter().all(|d| d.file != "src/main"));
        assert_eq!(diags[0].cycle, vec!["src/x", "src/y", "src/z", "src/x"]);
    }

    #[test]
    fn two_disjoint_cycles() {
        let t = table(&[
            ("a", &["b"]),
            ("b", &["a"]),
            ("c", &["d"]),
            ("d", &["c"]),
        ]);
        let diags = detect_cycles(&t);
        assert_eq!(diags.len(), 4);
        let files: Vec<&str> = diags.iter().map(|d| d.file.as_str()).collect();
        assert_eq!(files, vec!["a", "b", "c", "d"]);
    }

    #[test]
    fn strip_extension_variants() {
        assert_eq!(strip_extension("src/a.ts"), "src/a");
        assert_eq!(strip_extension("src/a.d.ts"), "src/a");
        assert_eq!(strip_extension("src/a.vue"), "src/a");
        assert_eq!(strip_extension("src/a"), "src/a");
    }
}
