# Proposal: G2 诊断契约 v3（confidence / cweTags / engineStatus / toolVersion / inline suppression / fail-on）

> change-id：`20261030-contract-v3` · 日期：`2026-10-30` · 状态：已实现

## 确认记录

- 2026-10-30：三层文档产出后，用户以消息全文 **「好的，按这个方案开始改代码」** 确认进入实现；确认范围 = 本目录 `proposal.md` / `design.md` / `tasks.md` 全量方案（含契约 v3 字段、抑制口径、`--fail-on` 语义与 SARIF 结构）。确认后才开始改代码面。

## 背景与问题

M4 契约验收要求「confidence/cweTags/fail-on/engineStatus/toolVersion/inline suppression 齐全；`--output` 不污染 stdout」（[upgrade-plan.md](../../upgrade/v0.1/upgrade-plan.md) M4 验收表）。升级计划 §7 G2 与本执行清单 W1 均把该组字段列为 P0；当前实现存在以下缺口：

1. **诊断模型缺平台消费字段**：`LintsightDiagnostic` 只有 `severity`（[diagnostic/index.ts](../../../packages/lintsight-diagnostic/src/index.ts)），没有逐 finding 的 `confidence`、`cweTags`；注册表已有 `confidence` 与 JS 规则的 `cwe-*` tags，但未进入报告。
2. **engineStatus 不可见**：`runEngine` 只返回 `degraded` 布尔（[engine-bridge.ts](../../../packages/lintsight-cli/src/engine-bridge.ts)），引擎缺失/崩溃/降级不进报告，平台无法区分「没引擎」与「引擎失败」。
3. **toolVersion 只存在于 SARIF**：JSON 报告无 `toolVersion`；SARIF 由 CLI 传入 `opts.toolVersion`，二者无单一契约字段。
4. **无行内抑制**：没有 `lintsight-ignore-next-line` 语法，也无审计 reason；SARIF 无 `suppressions`。
5. **CI 门禁无法按置信度收窄**：无 `--fail-on`，任何 error 都 exit 1，无法只拦 high confidence。
6. **`--output` 仍写 stdout**：[cli.ts](../../../packages/lintsight-cli/src/cli.ts) 在写文件后仍 `console.log(formatted)`，违反「`--output` 时 stdout 必须为空」。
7. **SARIF 缺 CWE/置信度/抑制消费面**：无 `taxonomies`、`properties.confidence`、`suppressions`。

## 目标与非目标

- 目标：
  - 诊断/报告契约升到 **v3**：逐 finding `confidence`、`cweTags`；报告级 `toolVersion`、`engineStatus`。
  - `engineStatus` 枚举 `ok | degraded | missing | crashed | timeout`，缺失引擎时报告可见。
  - 行内抑制 `// lintsight-ignore-next-line <ruleId>: <reason>`；reason 进入诊断审计字段与 SARIF `suppressions`；被抑制诊断不参与 exit / `--fail-on` / summary 计数。
  - `--fail-on high|medium|low`：只对「severity=error 且 confidence 不低于阈值」的未抑制诊断 exit 1；默认 `low` 保持现有语义。
  - SARIF：CWE `taxonomies` + `results[].taxa`、`results[].properties.confidence`、`results[].suppressions`。
  - `--output` 时 stdout 为空（报告只落文件）。
  - golden 升为 `report-v3.json`；SARIF/JSON 快照锁定。
  - scanner 消费确认（外部依赖，可在 G2 实现完成后补签，不阻塞代码验收）。
- 非目标：
  - 不实现 G6 的 fail-closed 开关、超时机制与四种失败场景全覆盖（G2 只定义五态枚举与当前可得状态的映射，`timeout` 留给 G6/G5 接线）。
  - 不改规则 message/messageId/指纹；不新增规则；不改默认启用面（G12）。
  - 不做平台侧基线/抑制同步（scanner 职责，D4）。
  - 不做 SARIF 之外的 GitLab CodeQuality 等格式。
  - 不改 Rust 规则实现；引擎协议仅在 TS 侧预留逐 finding `confidence` 可选位（Rust 本轮不发送）。
  - 不引入 schema 校验库/JSON Schema 文件（保持零依赖 formatter）。

## 方案选型

| 议题 | 方案 | 取舍 | 结论 |
| --- | --- | --- | --- |
| 抑制后的诊断如何表达 | A. 从 `diagnostics` 删除，另设 `suppressed` 数组；B. 保留在 `diagnostics`，加 `suppression` 审计字段；C. 删除且不输出 | A 需要双数组、SARIF 还要回填；C 丢失审计；B 与 SARIF `suppressions` 语义一致（结果仍在、标记被抑制） | **采纳 B** |
| `confidence` 来源 | A. 规则级常量写进每条诊断；B. finding 覆盖 → registry 默认 → `medium` 兜底 | A 无法表达逐 finding；B 保留「逐 finding」能力且当前零规则改动 | **采纳 B** |
| `--fail-on` 取值 | A. `error|warning|none`；B. `high|medium|low` 置信度阈值 | 需求明确「CI 只拦 error + high」；B 与 confidence 分级对齐 | **采纳 B** |
| engineStatus 生产 | A. 每个失败点各自字符串；B. 纯函数 `deriveEngineStatus` 统一映射 | B 可单测五态、避免分支漂移 | **采纳 B** |
| CWE 数据源 | A. 报告时读插件 meta；B. registry 增 `cweTags`，CI 校验与 meta 一致 | A 需要运行时插件对象，跨进程不可得；B 与现有 registry 单一账目一致 | **采纳 B** |
| 缓存与元数据 | A. 缓存键加入 registry 版本；B. 缓存命中时按当前 registry 重新水合 confidence/cweTags | A 每次元数据变更全量失效；B 只重算轻量字段 | **采纳 B** |

## 影响面清单

- 代码面：
  - `packages/lintsight-diagnostic/src/index.ts`（模型 v3、字段解析、抑制应用、summary 口径）
  - `packages/lintsight-diagnostic/src/registry.ts`（`cweTags` 数据）
  - `packages/lintsight-cli/src/engine-bridge.ts`（`EngineStatus`、`runEngine` 返回 status）
  - `packages/lintsight-cli/src/pipeline.ts`（报告级字段、抑制、fail-on、缓存水合）
  - `packages/lintsight-cli/src/cache.ts`（命中条目元数据水合调用；契约盐已随 `CONTRACT_VERSION` 生效）
  - `packages/lintsight-cli/src/cli.ts`（`--fail-on`、`--output` stdout 静默）
  - `packages/lintsight-formatter/src/index.ts` / `src/sarif.ts`（JSON/text/SARIF v3）
- 契约面：诊断 schema v3、`CONTRACT_VERSION='3'`、报告字段、SARIF 结构、CLI 参数面、exit 语义（默认不变）
- 测试面：diagnostic / formatter-SARIF / engine-bridge / pipeline / CLI 集成 / golden
- 文档面：本 change、`execution-todo.md` G2 证据、`upgrade-plan.md` 契约章节（实现前补充）
- 外部依赖：scanner 消费确认（可后补，不伪造签字）

## Breaking Changes

- **诊断契约 v2 → v3**：JSON 诊断新增 `confidence`/`cweTags`（逐 finding）、报告新增 `toolVersion`/`engineStatus`/`summary.suppressed`；golden 从 `report-v2.json` 迁移到 `report-v3.json`。
- **被抑制诊断仍在 `diagnostics` 中**，但带 `suppression` 字段且不计入 summary/exit；按纯 `diagnostics.length` 统计的下游需改为按 `summary` 或过滤 `suppression`。
- **SARIF** 新增 `taxonomies`/`taxa`/`properties`/`suppressions`；原有 ruleId/位置/指纹不变。
- **缓存兼容**：`CONTRACT_VERSION` 参与引擎指纹，v2 条目一次性 miss；命中条目在 pipeline 侧按当前 registry 水合元数据。
- **默认 exit 语义不变**：`--fail-on` 缺省 `low` = 现有「任何 error 即 exit 1」；只有显式 `--fail-on high/medium` 才收窄。
- 无规则文案、messageId、指纹变化。

## 验收标准

- `bun run test` 全绿；`cargo test --release` 52 passed（无 Rust 改动）；`lint` / `format:check` clean。
- 新增/更新测试：
  - `diagnostic.test.ts`：v3 字段解析、confidence 兜底、cweTags、抑制应用与 summary 口径。
  - `engine-bridge.test.ts`：`deriveEngineStatus` 五态；missing/crashed 由真实路径覆盖。
  - `suppression.test.ts`：合法/缺 reason/未知规则/多指令/冷热一致。
  - `fail-on.test.ts` / CLI 集成：high 不拦 medium，默认拦；`--output` stdout 为空。
  - `sarif.test.ts`：taxonomies/taxa/properties/suppressions 快照。
  - `report-snapshot.test.ts`：`report-v3.json` golden；用固定 `OXLINT_ENGINE_BIN` 不存在路径锁定 `engineStatus`，避免环境漂移。
- 缺引擎时报告含 `engineStatus`；scanner 消费确认可后补（用户已约定「G2 的 scanner 签字可后补」；签字前不宣称 G2 外部验收闭合，不伪造签字）。
- 不修改规则文案/指纹；`corpus:check` 按 G1 同样纪律：本 change 不改检测面，若基线漂移只做归因、不 `--save`。
