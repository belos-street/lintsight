# spike ① 验证报告：oxc crate 直连 PoC（M2 深度分析引擎路线）

> 日期：2026-10-01 · 验证人：引擎研发（AI 协助）
> 依据：[requirements-v0.2.md](../requirements/requirements-v0.2.md) §11.2「选型 spike ①」+ [oxc-toolchain skill](../../.agents/skills/oxc-toolchain/reference/oxc-crates.md) spike ① 验证清单
> 代码：`crates/oxc-poc/`（独立 cargo 工程，不进 Bun workspaces；`cargo build --release` 本地复现）
> 环境：cargo/rustc 1.98.1 · **oxc crates =0.150.0**（与 oxlint 1.83.0 同日发布对齐，`=` 精确锁）· macOS(Apple Silicon)

## 总结论

**M2 技术路线可行，L1/L2 基建（oxc_semantic + oxc_cfg）可直接白捡，DFG/taint 在其上自建的挂载点已实证存在。**

四项验证全部通过：

| # | 验证项（spike ① 清单） | 结论 | 说明 |
| --- | --- | --- | --- |
| 1 | parser→semantic→cfg 直连真实文件 | ✅ 通过 | scope 树/符号表/引用解析/CFG 块边/回边/DOT 全链路一次走通（见「关键实证」#1） |
| 2 | 10 万行 parse+semantic 耗时与内存 | ✅ 通过 | 101,200 行 = 29ms（parse 13ms + semantic+cfg 16ms），**3.49M LOC/s**，为 NFR-1 预算（15 万 LOC/s）的 **23 倍**；峰值 RSS ≈ 110MB（约 1.1KB/LOC） |
| 3 | AstKind 覆盖度抽查 | ✅ 通过 | 真实项目文件覆盖 48~64 种 kind；P0 规则相关节点类型全部存在（CallExpression / MemberExpression 三变体 / Await / Template / Catch…） |
| 4 | 版本锁定策略试运行 | ✅ 通过 | `=0.150.0` 精确锁 + cargo-deny 门禁可用：oxc 家族 11 crate 单版本无漂移；上游传递依赖 2 组重复（hashbrown/syn）warn 观测 |

合成语料为控制流高密度（1.55 CFG 块/行，真实代码约 1.0~1.3），性能数字按保守口径采信。

## 关键实证

### 1. 全链路直连（walk 模式，`crates/oxc-poc/sample.ts`）

```bash
cargo run --release -- walk sample.ts
```

- **scope 树**：嵌套作用域 + `ScopeFlags`（StrictMode / Function / CatchClause）完整；`get_bindings(scope)` 给出 名称→SymbolId→引用数 三级链。
- **符号表**：`symbol_name/span/flags` 齐全，flags 可区分 `Function`、`CatchVariable`、`ConstVariable` 等（taint 规则的 sink 判定直接可用）。
- **引用解析**：resolved=16，unresolved(global)=4（`Error/Promise/console/fetch`）——全局引用与局部绑定天然分流，import/export 绑定进 L1 层无障碍。
- **CFG**：39 basic blocks；边类型齐全 `Jump/Normal/Backedge/Error(Explicit|Implicit)/Unreachable/NewFunction`。
- **回边证明**：样例 2 个循环（while + for-of）→ 恰好 2 条 `Backedge`（bb14→bb4、bb26→bb21）。**L2 层「免建」结论成立**。
- **AST↔CFG 桥**：146 个 AST 节点经 `nodes.cfg_id(node_id)` 映射到 24/39 个 CFG 块（其余为条件中继块）。**这就是 def-use/DFG 状态挂载的落点**：沿 CFG 前向 worklist 传播，状态按 `SymbolId` + `cfg_id` 寻址。
- **DOT 导出**：`cfg.display_dot()` 一步到位（4.8KB），可直接喂平台可视化。

### 2. 性能（bench 模式，合成语料 101,200 行 / 2.3MB / 4,600 函数）

| 阶段 | 耗时（3 轮取 best） |
| --- | --- |
| parse（TS mode） | 13ms |
| semantic + cfg（`with_build_nodes(true)` + `with_cfg(true)`） | 16ms |
| **合计** | **29ms → 3,489,655 LOC/s** |
| 对照组：`new_linter()` 全量（nodes+cfg+class_table+syntax-check） | 16ms（semantic 阶段） |
| 峰值 RSS（`/usr/bin/time -l`） | ~110MB ≈ **1.1KB/LOC** |

- 对照 NFR-1「15 万 LOC/s、10 万行 <60s」：**余量 23 倍**，M2 性能风险解除。
- 内存推断：百万行全量 ≈ 1.1GB 峰值 → **「AST 流式释放（跑完即弃）」从建议升级为硬约束**；按 tsconfig/workspace 分批 + `Allocator` 每 batch drop 即可控制。

### 3. API 形状（0.150.0 实测，docs.rs 与此一致）

```rust
// 解析（SourceType::from_path 自动识别 .ts/.tsx/.js/.mjs）
let ret = Parser::new(&allocator, source, source_type).parse();
// ParserReturn 字段（0.150.0）：program / module_record / diagnostics /
//   irregular_whitespaces / tokens / fatal_error / is_flow_language
// ⚠️ 无 panicked、无 errors 字段——fatal_error + diagnostics.has_errors()

// 语义 + CFG（两处必须显式开，默认都是关的）
let ret = SemanticBuilder::new()
    .with_build_nodes(true)   // ⚠️ new() 默认 false（Scoping-only 轻量模式），不开则 nodes().len()==0
    .with_cfg(true)           // ⚠️ 且 Cargo.toml 需要 oxc_semantic features=["cfg"]
    .build(&program);
let cfg = ret.semantic.cfg().unwrap();          // Option<&ControlFlowGraph>
let dot = cfg.display_dot();                    // oxc_cfg::DisplayDot trait
// petgraph 经 oxc_cfg::graph / oxc_cfg::graph::visit 再导出，无需直接依赖
```

- `AstNodes`：`iter()` / `iter_enumerated()` 全量遍历；`cfg_id(node_id)` 节点→CFG 块随机访问；`ancestor_ids()` 向上溯源。
- `Scoping`：`scope_descendants_from_root()`（全量 scope）、`iter_bindings()`（scope→(Ident,SymbolId)）、`get_resolved_reference_ids(symbol)`、`root_unresolved_references()`（全局引用表）。
- `Bindings` 键为 `Ident`（arena 哈希），`as_str()` 取名。

### 4. AstKind 覆盖度

- 抽查清单 34 项（taint/安全 P0 规则依赖的节点类型，见 `src/main.rs` `RULE_RELEVANT`）。
- 真实文件实测：pipeline.ts 64 种 / oxlint-bridge.ts 53 种 / vue-processor 48 种 distinct kinds；清单内未命中的均为该文件未用到的语法（如 Class/JSX），**零假缺失**。
- MemberExpression 按 oxc 设计拆为 `Static/Computed/PrivateField` 三变体——Rust 轨道规则写法需按此适配（JS 轨道无感知）。

### 5. 版本锁定试运行

- `Cargo.toml` 全部 `=0.150.0`；`cargo tree` 确认 oxc 家族 11 crate 单一版本。
- `cargo deny check bans`（`deny.toml` 入库）：门禁跑通。`multiple-versions` 初始 deny 实测拦到 **上游**传递依赖 2 组重复（hashbrown 0.15/0.17、syn 2/3）——oxc 生态自身无漂移，此为我方不可控项，策略定为 **warn 观测 + M2 正式化时 skip 显式登记**。
- 升级纪律（version-policy.md）在 Cargo 侧可执行，M2 建仓时原样复制。

## 坑与要点（M2 工程注意）

1. **`with_build_nodes` 默认关**：`SemanticBuilder::new()` 是 Scoping-only 轻量模式，忘开会得到"作用域/CFG 正常但 AST 节点表为空"的隐性错误。深度引擎一律 `new_linter()` 或显式 `with_build_nodes(true)+with_cfg(true)`。
2. **`cfg` 是 oxc_semantic 的非默认 feature**：漏开时 `with_cfg(true)` 走 no-op 分支且 `cfg()` 恒 None，无编译错误。
3. **ParserReturn 字段名**：0.150.0 已是 `fatal_error` + `diagnostics`（旧教程的 `panicked`/`errors` 已失效）；Diagnostics 判空用 `has_errors()`。
4. **1.1KB/LOC 峰值内存**：百万行场景必须流式分批（每文件/每 batch `Allocator` drop），与 requirements §3.5「AST 流式释放」约束对齐。
5. **oxc 版本节奏**：周更（0.149→0.152 仅隔 3 周）。M2 锁死 `=`，升级按 version-policy 门禁走独立评审；对齐 oxlint 版本的口径 = **npm oxlint 发布日 + oxc crates 同日发布版**（本次 1.83.0 ↔ 0.150.0，2026-09-14）。

## M2 落地建议

- **L1/L2 直接消费**：semantic/cfg GA 可用，免建成立；def-use / DFG / taint 为自建区（与 requirements §2.4 判断一致）。
- **DFG 挂载点**：状态按 `SymbolId + cfg_id` 寻址，沿 CFG 前向 worklist 传播；`EdgeType::Backedge` 需要进 worklist 循环终止条件（不动点迭代）。
- **双引擎衔接**：Rust 引擎可直接复用 `new_linter()` 级配置对齐 oxlint 行为基线，报告层合并按 M1-DR2 指纹口径。
- **建议排期**：M2 首切片 = 竖切单文件 taint PoC（source→sanitizer→sink 沿本报告 CFG 链路），不必等跨文件模块图。

## 交付物

- PoC 工程：`crates/oxc-poc/`（`Cargo.toml` + `src/main.rs` + `sample.ts` + `deny.toml`；`sample.cfg.dot` / `target/` 为运行产物，已 gitignore）
- 复现命令：`cargo build --release` → `./target/release/oxc-poc walk sample.ts` / `bench 4600` / `astkind <file>...`
