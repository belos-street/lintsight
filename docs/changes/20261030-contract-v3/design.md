# Design: G2 诊断契约 v3

> change-id：`20261030-contract-v3` · 日期：`2026-10-30`

## 技术设计

### 1. 诊断模型 v3

```ts
export type Confidence = 'high' | 'medium' | 'low'
export type EngineStatus = 'ok' | 'degraded' | 'missing' | 'crashed' | 'timeout'

export interface Suppression {
  kind: 'inSource'
  /** 指令里的 reason（必填，进审计） */
  justification: string
  /** 指令所在行（1-based，原文件坐标） */
  directiveLine: number
}

export interface LintsightDiagnostic {
  contractVersion: '3'
  ruleId: string
  severity: string
  message: string
  file: string
  span: OxlintSpan
  fingerprint: string
  owner: Owner
  confidence: Confidence
  cweTags: string[]
  pathEvents?: PathEvent[]
  /** 仅被行内指令抑制的诊断带此字段 */
  suppression?: Suppression
}
```

字段解析：

```text
confidence = findingOverride ?? registryEntry(ruleId)?.confidence ?? 'medium'
cweTags    = (registryEntry(ruleId)?.cweTags ?? []).map(t => t.toUpperCase())
```

- `cweTags` 对外统一为 CWE 官方大写形态（`CWE-79`）；registry/插件 meta 内部仍用小写，输出时大写化，JSON 与 SARIF 同口径。
- `findingOverride` 只在引擎协议预留（TS 侧 `EngineDiagnostic.confidence?`）；Rust 本轮不发送，所有 finding 暂取 registry 默认，但模型已支持逐 finding。
- 未登记规则（oxlint-native、`internal/*`）默认 `medium` + 空 `cweTags`；避免未校准规则被 `--fail-on high` 直接拦。
- **指纹不变**：`computeFingerprint` 仍只用 ruleId/file/span/message；新增字段不参与。
- 缓存命中时用 `refreshDiagnosticMetadata(d)` 按**当前 registry** 重算 `confidence`/`cweTags`，避免 registry 元数据变更后缓存陈旧。已知限制：M1 无 finding 级覆盖；若未来缓存 finding 覆盖，需增加来源标记，避免水合覆盖逐 finding 值。

`registry.ts` 增加 `cweTags: string[]`：

- `lintsight-js` 条目：CI 校验与插件 `meta.tags` 中以 `cwe-` 开头的项**集合相等**；
- `lintsight-engine` 条目：按 design-m2/CWE 注释手工登记（no-eval CWE-95、path-traversal CWE-22、command-injection CWE-78、ssrf CWE-918、prototype-pollution CWE-1321、open-redirect CWE-601；架构/循环/深导入为空）。

### 2. 报告 v3

```ts
export interface LintsightReport {
  contractVersion: '3'
  toolVersion: string
  engineStatus: EngineStatus
  files: number
  summary: { error: number; warning: number; info: number; suppressed: number }
  diagnostics: LintsightDiagnostic[]
}
```

- `toolVersion` = CLI 包版本（pipeline 已有 `pkg.version`）；SARIF `driver.version` 同源。
- `summary` 只统计**未抑制**诊断；`suppressed` 单独计数。
- `files` 语义不变。
- 报告级字段不进指纹；诊断级 `contractVersion` 同为 3。

### 3. engineStatus 映射

新增纯函数（可单测五态）：

```ts
deriveEngineStatus(input: {
  bin: string | null
  timedOut?: boolean
  crashed?: boolean
  missingRules?: string[]
}): EngineStatus
```

优先级：`missing > timeout > crashed > degraded > ok`。

| 输入 | 状态 |
| --- | --- |
| 二进制解析为 null | `missing` |
| `timedOut=true`（G6/G5 接线，G2 仅类型与单测） | `timeout` |
| spawn 失败 / exit≠0 / 协议 JSON 损坏 | `crashed` |
| summary 规则面缺常驻规则 | `degraded` |
| 其余 | `ok` |

`runEngine` 返回 `{ diagnostics, degraded, status }`；`degraded` 保留给现有 CLI 告警，语义 = `status ∈ {degraded, crashed, timeout}`（`missing` 为 false）。pipeline 把 `status` 写入报告 `engineStatus`。**G2 不实现超时与 fail-closed**；`timeout` 由 G6/G5 接真实信号。

### 4. 行内抑制

语法（仅行注释，v1）：

```ts
// lintsight-ignore-next-line <ruleId>: <reason>
```

解析与应用：

1. 只对**本轮有诊断**的文件读取原文件内容（`.vue` 读原 `.vue`，不是虚拟块）；按 `storeRel` 缓存一次。已知边界：干净文件里的非法指令不会解析/告警（性能考虑，契约中明示）。
2. 逐行匹配：`^\s*//\s*lintsight-ignore-next-line\s+([^\s:]+)\s*:\s*(.+?)\s*$`。
3. `reason` 必须非空；`ruleId` 精确匹配诊断 `ruleId`。
4. 指令作用于**下一行**：`diag.span.line === directiveLine + 1` 且同文件；多行 span 以起始行为准。
5. 非法指令（缺 reason / 缺 ruleId）→ logger.warn，不抑制、不中断。
6. 应用时机：`suppressSuperseded` 之后、`sortDiagnostics` / summary / exit 之前。
7. 命中后：诊断保留在 `report.diagnostics`，写入 `suppression = { kind: 'inSource', justification, directiveLine }`；从 summary、exit、`--fail-on` 计数中排除。
8. 同一文件多条指令各自独立；同一行同 rule 重复指令 → 首次生效并 warn。
9. 冷/热一致：抑制在缓存命中后每轮重新应用，缓存条目仍是抑制前原始诊断。

> 为什么保留被抑制诊断而不是删除：SARIF `suppressions` 语义要求结果仍在 `results[]`；平台审计也需要 reason。JSON 消费者应以 `summary` 或 `suppression` 字段为准，而不是 `diagnostics.length`。

### 5. `--fail-on` 与 exit

- CLI：`--fail-on <high|medium|low>`，缺省 `low`；非法值 exit 2。
- 置信度秩：`high=3 > medium=2 > low=1`。
- exit 1 条件：存在**未抑制**、`severity === 'error'`、且 `rank(confidence) >= rank(failOn)` 的诊断。
- 默认 `low` = 现有「任何 error 即 1」；warning 永不触发 exit 1。
- 被抑制诊断不参与；runtime 错误仍 exit 2。
- `PipelineResult.exitCode` 联合类型不变（0/1/2）。

### 6. SARIF v3 结构

- `runs[0].taxonomies`：单个 `CWE` taxonomy，`informationUri=https://cwe.mitre.org/`，`taxa[]` 来自报告中出现的 `cweTags`（排序去重，`id` = `CWE-79`，`name` = 同 id）。
- `results[].taxa`：引用 taxonomy 的 `reportingDescriptorReference`，含 `id`、`index`、`toolComponent: { name: 'CWE' }`。
- `results[].properties.confidence`：逐 finding 置信度。
- `results[].suppressions`：被抑制诊断写 `[{ kind: 'inSource', justification }]`；`properties.directiveLine` 记录指令行。
- `rules[].properties.cweTags`：规则目录可选展示。
- `driver.version` / `semanticVersion` = `toolVersion`（现有 opts 路径不变）。
- 不为空字段输出空对象；无 CWE / 无抑制时省略对应结构，保持快照干净。

### 7. `--output` stdout 契约

- 有 `--output`：只 `Bun.write(path, formatted)`；不再 `console.log`。日志仍走 stderr。
- 无 `--output`：行为不变（报告写 stdout）。
- 退出码与格式选择不受影响。

### 8. 缓存与契约版本

- `CONTRACT_VERSION='3'` 参与 `engine` 指纹（`cache.ts` 已引用），v2 条目全部 miss，fail-open 重扫。
- 命中条目在 pipeline 读取后调用 `refreshDiagnosticMetadata`；抑制随后应用。
- 不新增缓存键成分；registry 元数据变更由水合覆盖，规则行为变更仍由 lintsightVersion/plugin 指纹击穿。

## 涉及文件清单

- 改动：`packages/lintsight-diagnostic/src/index.ts`
- 改动：`packages/lintsight-diagnostic/src/registry.ts`
- 改动：`packages/lintsight-cli/src/engine-bridge.ts`
- 改动：`packages/lintsight-cli/src/pipeline.ts`
- 改动：`packages/lintsight-cli/src/cache.ts`（仅水合调用/注释）
- 改动：`packages/lintsight-cli/src/cli.ts`
- 改动：`packages/lintsight-formatter/src/index.ts`
- 改动：`packages/lintsight-formatter/src/sarif.ts`
- 新增：`packages/lintsight-diagnostic/src/suppression.ts`（解析为纯函数）
- 新增/改动测试：`diagnostic.test.ts`、`registry.test.ts`、`engine-bridge.test.ts`、`suppression.test.ts`、`fail-on.test.ts`、`cli-output.test.ts`、`sarif.test.ts`、`report-snapshot.test.ts`、`closed-loop.test.ts`
- 重命名：`packages/lintsight-cli/test/__golden__/report-v2.json` → `report-v3.json`
- 改动（工具配置）：`.oxfmtrc.jsonc` 忽略 `packages/lintsight-cli/test/__golden__`（golden 由 `formatJson` 逐字节生成，格式化会破坏快照）
- 文档：`docs/upgrade/v0.1/execution-todo.md`、`docs/upgrade/v0.1/upgrade-plan.md`（契约章节）、`.agents/memory/decisions.md`（如新增长期决策）
- Rust：无改动
- fixtures：无新增（抑制用例在测试 tmpdir 自建项目，避免改动规则用例契约面）

## 规则 / 引擎影响

- 规则 ID / category / severity / confidence：报告新增 confidence 字段，**取值来自现有 registry**，不改规则实现。
- 检测层 / source/sink/sanitizer：无变化。
- 注册表：新增 `cweTags` 数据 + CI 一致性校验；不改规则启用面。
- 指纹 / message / golden / SARIF：指纹与 message 不变；golden 与 SARIF 快照因新增字段更新。
- 引擎调用面：新增 status 返回；引擎协议 TS 侧预留 `confidence?`，Rust 不发送。

## 测试计划

| 层 | 测试 | 断言 |
| --- | --- | --- |
| diagnostic | `v3 字段：confidence 取 registry / 未登记兜底 medium / cweTags 透传` | 字段值与 registry 一致；指纹不变 |
| diagnostic | `抑制解析：合法 / 缺 reason / 缺 ruleId / 未知规则` | 合法命中；非法 warn + 不抑制 |
| diagnostic | `抑制应用：next-line 精确、多行 span 起始行、summary 排除、suppression 审计` | `summary` 与诊断数组口径分离 |
| registry | `cweTags 与 JS 插件 meta.tags 一致；engine 条目显式非空/空集合` | CI 漂移即红 |
| engine-bridge | `deriveEngineStatus 五态（含 timeout 合成输入）` | 优先级与映射表一致 |
| engine-bridge | `missing（bin=null）/ crashed（不存在 OXLINT_ENGINE_BIN）/ degraded（规则面缺）` | status 正确、degraded 兼容 |
| suppression E2E | `冷/热/--no-cache 抑制一致；.vue 原文件行号；引擎 no-eval 可抑制` | 三种模式诊断集合一致 |
| fail-on | `默认 low 拦 medium；high 放行 medium；被抑制 error 不拦；warning 永不拦` | exit 0/1 精确 |
| CLI 集成 | `--output 时 stdout 为空、文件可解析；无 --output 时 stdout 有报告` | spawn CLI 断言 |
| SARIF | `taxonomies/taxa/properties.confidence/suppressions` | 快照 + schema 字段 |
| golden | `report-v3.json`（固定 `OXLINT_ENGINE_BIN` 指向不存在路径 → engineStatus 稳定） | 环境无关快照 |
| 回归 | `closed-loop contractVersion='3'`；`report.files/summary` 不变 | 现有断言更新 |

命令：

- `bun run build:rules && bun test packages/lintsight-diagnostic packages/lintsight-formatter packages/lintsight-cli/test/{suppression,fail-on,cli-output}.test.ts`
- `bun run test`
- `cargo test --release --manifest-path crates/lintsight-engine/Cargo.toml`（无 Rust 改动）
- `bun run lint` / `bun run format:check`
- `bun run corpus:check`（不改检测面；漂移只归因、不 `--save`）

## 风险与已知坑

1. **golden 环境漂移**：`engineStatus` 依赖引擎存在性。快照测试固定 `OXLINT_ENGINE_BIN` 为不存在路径，锁定为 `crashed`；真实 `ok`/`missing`/`degraded` 由 engine-bridge 单测覆盖。若认为 golden 应展示 `ok`，需给测试注入 fake 引擎（成本更高），本轮不做。
2. **抑制可能掩盖安全问题**：reason 必填、审计字段与 SARIF suppressions 保留可追溯；不提供 `all` 通配与过期机制，平台侧基线/抑制同步仍归 scanner（D4）。
3. **`diagnostics.length` 口径变化**：被抑制诊断仍留在数组。须在契约说明与 scanner 联调中明确「summary/未抑制集合」为准；这是 B 方案的已知消费面变更。
4. **CWE 手工登记漂移**：JS 条目由 registry 测试与插件 meta 对齐；engine 条目只能人工评审（注释中的 CWE 是来源），新增引擎规则必须同步登记。
5. **`--fail-on high` 放行低/中置信 error**：这是特性不是缺陷（需求明确 CI 只拦 error+high）；默认 `low` 保持旧行为，避免升级后 CI 行为突变。
6. **timeout 状态暂不可达**：G2 只定义映射与单测；真实超时由 G6/G5 接线，验收口径不得写成「超时已覆盖」。
7. **scanner 签字外部依赖**：G2 代码验收可完成，但外部消费确认可后补；未签字前不宣称 M4 契约项闭合（与 H4/双跑同纪律）。
8. **SARIF taxonomies 体积**：CWE taxa 只收录报告出现的标签，不内嵌全量 CWE 字典，避免报告膨胀。
