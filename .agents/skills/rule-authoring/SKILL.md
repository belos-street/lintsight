---
name: "rule-authoring"
description: "lintsight 规则（checker）开发流程：检测层选型、RuleTester 用例先行、meta 完备性、语料库门禁与误报分析。在 lintsight 仓库写/改任何 lint 规则、评审规则清单、处理误报时必读。"
---

# rule-authoring

lintsight 的规则是平台承诺——每条规则自带 meta 契约、误报自证与语料库门禁。本 skill 定义从需求到合入的完整流程。

## 使用场景 → 读哪篇

| 你在做什么 | 先读 |
|-----------|------|
| 从 0 写一条新规则（JS 轨道 / Rust 轨道） | [rule-anatomy](reference/rule-anatomy.md) |
| 写 RuleTester 用例、跑语料库门禁、写误报分析 | [testing-and-gating](reference/testing-and-gating.md) |
| 处理 ◆ 规则的 M2 taint 升级 | [rule-anatomy](reference/rule-anatomy.md) + 技术设计文档 §3.6 |
| 评审规则清单 / 定 confidence | [testing-and-gating](reference/testing-and-gating.md) |

## 一条规则的生命周期（7 步，不可跳步）

1. **需求溯源**：规则必须挂在 FR 编号或附录 A 条目下——没有编号不写规则。
2. **检测层选型**：`none`（纯语法）→ `local`（文件内类型/作用域推导）→ taint（M2，需 CFG/DFG）；需要跨文件类型事实的**不写**，映射到 oxlint --type-aware 规则集（AGENTS.md 铁律 3）。
3. **用例先行**：先写 RuleTester 的 invalid/valid 用例（含 safe case），再写实现——用例就是验收契约（见 testing-and-gating）。
4. **实现**：只依赖 SDK 面（`RuleContext`/`SourceCode`/`fixer`），禁止触碰 parser AST 内部类型（铁律 2）。
5. **meta 完备**：FR-203 字段全齐，缺一 CI 拒合。
6. **语料库门禁**：全量语料重扫、diff 评审、误报分析随 PR 提交（FR-702）。
7. **登记**：规则注册表登记四元组（ruleId/owner/检测层/状态，技术设计文档 §3.6），文档补 `falsePositives`。

## Rationalizations to Reject（写规则时的自我说服，全部拒绝）

- "模式看起来完整了" → 语料库 diff 没跑就等于没写完。
- "能匹配漏洞场景就够了" → **safe case 不匹配是另一半工作**——误报摧毁的是工具信誉（NFR：宁漏报不误报）。
- "先写死规则逻辑再补用例" → 用例先行，实现是给用例打工的。
- "一条用例够说明问题了" → 边界矩阵：不同写法、清洗后的输入、安全替代写法、跨行/跨作用域。
- "正则匹配一下代码就行" → 除纯词法类（凭证检测）外禁止（技术设计文档 §10 反模式 8）。
- "confidence 先标 high 再说" → confidence 是 CI 门禁依据，乱标 = 上线即拦错（§testing-and-gating 的评级依据）。

## 硬性约束速记

- 单规则单文件 O(n) 为主；需要索引查询用 ctx 提供的懒构建索引，禁止规则间各自全量扫描。
- fix 分级：`safe`（--fix 默认）/ `suggestion`（IDE code action）/ `dangerous`（显式开关）。
- M1 生命周期只有 `create` / `onFileStart` / visitor / `onFileEnd`；`onProgramEnd` 是 M2 Rust 轨道钩子。
- ◆ 规则 M2 升级 taint 后，JS 版由注册表标记 retired（§3.6）——升级 PR 必须同时改注册表与配置默认值。
