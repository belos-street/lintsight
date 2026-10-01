# spike ⑤ 验证报告：taint 竖切预演（污点传播模型 · M2 T2.0 门禁）

> 日期：2026-10-01 · 验证人：引擎研发（AI 协助）
> 依据：todo T2.0 门禁任务 + [spikes/oxc-crate-poc.md](oxc-crate-poc.md)（spike ① 挂载点结论承接）
> 代码：`crates/oxc-poc/src/taint.rs`（taint 模式）+ `crates/oxc-poc/taint-fixture.ts`（三场景用例）
> 环境：oxc crates =0.150.0 · rustc 1.98.1

## 总结论

**「沿 CFG worklist 传播」的污点模型可行，design-m2 可依此定稿。** 单文件 source→sanitizer→sink 三场景全部按预期判定，不动点 28 轮收敛，回边/去重正确。

| # | 验证线 | 结论 |
| --- | --- | --- |
| 1 | 参数 source → `path.join` 传播 → sink | ✅ 命中（loadSave:8:10） |
| 2 | `path.basename` sanitizer 打断传播 | ✅ loadSafe 零命中（13:10 处 safePath 不污染） |
| 3 | `readdirSync` source → for-of 循环回边 → sink | ✅ 命中且去重正确（loadAll:23:14） |

## 模型定义（spike 定稿版）

```
source       函数参数（FormalParameter，保守近似外部输入）+ fs.readdirSync 调用结果
sanitizer    path.basename（剥离目录穿越的标准清洗）
sink         fs.readFileSync / readFile / writeFileSync 第一参数被污染
propagation  path.join 返回值（任一实参污染则结果污染）、直接赋值、for-of 迭代变量
worklist     CFG 块前向传播；块内节点按构建序（≈源码序）；污染集单调只增 → 不动点必收敛
```

- 初始污染：全部 source 符号预置到每个块入口。保守近似的安全性依据：参数 symbol 只会被其函数体内的引用解析到（oxc 作用域解析保证），跨函数假阳性被天然抑制；精确的函数入口块定位（NewFunction 边）是 T2.3 的增强项。
- sink 去重：回边不动点会重复进入块，按 span offset 去重。

## 关键实证

### 1. 挂载点链路全部走通（承接 spike ①）

```
IdentifierReference::reference_id() → ReferenceId
  → 反向表 ReferenceId→SymbolId（遍历 Scoping::symbol_ids() × get_resolved_reference_ids 构建）
BindingIdentifier::symbol_id()（声明处直接取符号）
nodes.cfg_id(node_id) → AST 节点分块（按块分组 + NodeId 升序 = 块内源码序）
graph.neighbors_directed(block, Outgoing) → 后继块传播
```

### 2. API 认知修正（0.150 实测，docs.rs 同步）

- `BindingPattern` **本身是 enum**（BindingIdentifier/ObjectPattern/ArrayPattern/AssignmentPattern/RestElement 变体）——**无 BindingPatternKind 包装层**（旧版 API 记忆失效点）
- `Scoping::symbol_ids()` 全量遍历 + `get_resolved_reference_ids(sid)` 构建反向表是标准的引用解析路径
- `oxc_cfg::graph::Direction`（顶层 `oxc_cfg::Direction` 为 private）；`oxc_cfg::graph::visit::EdgeRef` 需显式导入
- `NodeId::new(usize)`、`ReferenceId/SymbolId.index() → u32`

### 3. 模型设计教训（T2.3 的直接输入）

- **source/sink 函数表不得交叠**：初版把 readdirSync 同时放进 source（调用结果污染）和 sink（目录参数被污染）——导致 dir 参数命中 readdirSync 产生自指报告。定案：**source 函数一律不进 sink 表**，其结果经传播到其它 sink 才报。
- **for-of 迭代变量是 readdir 消费的主形态**，漏掉即断链（case 3 初版零命中）；for-of 的 right 污染 → left 声明符号必须显式处理。
- **去重必须内建**：回边不动点重复进入块是正常行为，sink 报告按 offset 去重。

## 实测输出（taint-fixture.ts，18 blocks / 28 edges / 5 sources）

```
[sink #1] taint-fixture.ts:23:14  via fs.readFileSync   ← case 3（readdir→for-of→join→readFileSync）
[sink #2] taint-fixture.ts:15:10  via fs.readFileSync   ← case 1（参数→join→readFileSync）
[sink #3] taint-fixture.ts:8:10   via fs.readFileSync   ← case 1 的第一个文件块（worklist 首轮）
case 2（basename sanitizer）零命中 ✓
worklist 28 轮收敛（18 块 / 28 边 / 含 2 条回边）
```

## 对 design-m2 的输入

1. **传播模型定案**：CFG worklist + SymbolId 状态 + 语法级传播规则表（join/赋值/for-of）——T2.3 按此实现产品版。
2. **状态挂载**：`SymbolId` 集合按块寻址（`cfg_id` 分组）；跨过程（M3）再扩展堆上抽象。
3. **规则表治理**：source/sanitizer/sink 函数表进注册表（与 confidence 同通道），表交叠在登记期校验拒绝（spike ⑤ 教训 #1）。
4. **协议预演**：taint 模式的输出形态（结构化 sink 清单）= design-m2 诊断流的 payload 原型。
