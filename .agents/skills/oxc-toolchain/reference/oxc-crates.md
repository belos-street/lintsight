# oxc crates 参考（M2 深度分析引擎 / spike ①）

> 事实核对基准：docs.rs 各 crate 文档 + oxc GitHub 源码。本文写于 2026-09，API 以 docs.rs 当前版本为准；与本文冲突时以 docs.rs 为准并回来修订。

## crate 全景

| crate | 职责 | lintsight 用途 |
| --- | --- | --- |
| `oxc_parser` | JS/TS 解析 → AST | M2 深度引擎入口（M1 由 oxlint 托管，不直连） |
| `oxc_ast` | AST 类型 + `AstKind`/`AstNodes` | 规则遍历与节点查询 |
| `oxc_semantic` | 语义分析：scope chain、symbol table、reference tracking、ClassTable、JSDoc、可选 CFG | L1 层免建；`SemanticBuilder` 构建 |
| `oxc_cfg` | 控制流图：basic blocks、条件/无条件/异常边、petgraph 图分析、DOT 导出、visitor 集成 | L2 层地基；在其上自建 def-use/DFG |
| `oxc_span` | `Span`（u32 offset 对）与源码定位 | 一切位置信息的基础 |
| `oxc_linter` | oxlint 本体的规则框架（可参考其规则实现，不建议直接依赖内部 API） | 学规则写法、读unicorn port |

## 必须内化的三个设计事实

### 1. arena + 索引，不是指针图

oxc 把"带环共享图"拍平成连续数组：`SymbolTable`/`Scoping` 全是 `Vec` + `HashMap`，查询靠 `SymbolId`/`ReferenceId`/`ScopeId`（u32 索引），AST 节点里存 `Cell<Option<ReferenceId>>` 而非指针。**写深度引擎时同样禁止 `Rc<RefCell<...>>` 建图——该用 `usize`/`u32` 索引就用索引**（呼应 rust-best-practices 的 data-modeling 篇）。

### 2. AST 不是 ESTree

oxc 手写了 `BindingIdentifier` / `IdentifierReference` / `IdentifierName` 三个不同类型，让"把表达式当声明用"在编译期报错。后果：

- ESLint 生态的 AST 遍历经验不能照搬（类型名、遍历顺序细节不同）；
- 遍历顺序按 ECMAScript 求值序，确定性优于 ESTree 实现；
- **JS 轨道规则完全感知不到这些**（走 ESLint 兼容 API），只有 Rust 轨道需要掌握。

### 3. `Semantic` 是一次构建的只读快照

`Semantic` 含 AST（`AstNodes`）、`Scoping`（作用域/符号/引用）、`ClassTable`、CFG（可选）。注意：

- 用 `SemanticBuilder` 构建，不要手工构造；
- `into_scoping()` / `into_scoping_and_nodes()` 拿走所有权后原 `Semantic` 不可再用；
- **`scoping_mut` 的存在说明符号表可变**——深度引擎做 taint 状态附着时可利用，但规则间共享时要防写冲突。

## oxc_cfg 边界（为什么 DFG 要自建）

oxc_cfg 只有 ~932 SLoC（v0.120.0 实测）：CFG 构建、基本块、图遍历、DOT 导出。**没有**：def-use 链、到达定值、数据流方程求解框架、taint 传播。这正是 lintsight 的差异化空间（FR-301/302）。

自建 DFG 的落点建议：

- def-use：基于 `Scoping` 的 symbol→references 映射 + CFG 内基本块内定值序；
- 污点状态：沿 CFG 前向 worklist 传播，状态挂 `SymbolId` + 表达式 temp；
- 事件流：传播步直接产出附录 C 的 `PathEvent`（source/propagation/branch/loop/call/return/sink）。

## spike ① 验证清单（M0）

- [ ] oxc_parser/semantic/cfg 直连一个真实文件，打印 scope/symbol/CFG DOT；
- [ ] 10 万行语料解析+语义构建耗时与内存（对照 NFR-1 的 15 万 LOC/s 预算）；
- [ ] `AstKind` 覆盖度抽查：附录 A 规则涉及的节点类型是否齐全；
- [ ] oxc 版本锁定策略试运行（Cargo `=` 精确锁 + `cargo deny`）。

## 官方资源

- 文档：https://oxc.rs · Rust API：https://docs.rs/oxc_semantic 等各 crate
- 源码：https://github.com/oxc-project/oxc （oxlint 规则实现是最佳教材：`crates/oxc_linter/src/rules/`）
- 升级纪律：见 [version-policy](version-policy.md)
