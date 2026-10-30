# Proposal: G6 fail-open 可观测（missing / crashed / protocol / timeout / fail-closed）

> change-id：`20261030-fail-open-observability` · 日期：`2026-10-30` · 状态：草稿

## 背景与问题

G2 已把 `engineStatus` 写进报告（`ok | degraded | missing | crashed | timeout`），但失败语义仍不完整：

1. **missing 与 crashed 混在一起**：`resolveEngineBin` 对 `OXLINT_ENGINE_BIN` 只做非空判断，不校验存在性；路径不存在时仍进入 spawn，最终按 `crashed` 处理（[engine-bridge.ts](../../../packages/lintsight-cli/src/engine-bridge.ts)）。「未安装」与「装了但坏了」无法区分，也无法验证 missing 的报告路径。
2. **协议损坏没有独立可验证的证据**：损坏 JSON 当前走 spawn 异常路径；测试里用 `.sh` 假引擎在 Windows 上实际是 spawn 失败，并没有真正覆盖「进程 exit 0 但输出非 JSON」的解析分支。
3. **timeout 只有类型没有信号**：G2 定义了 `timeout` 状态，但 `runEngine` 没有超时机制，状态永远不可达。
4. **非 ok 状态仍然静默**：pipeline 只在 `degraded=true` 时告警；`missing` 完全无声。报告虽有 `engineStatus`，CLI 运行日志没有统一提示。
5. **CI 无法 fail-closed**：引擎缺失/崩溃/超时/降级时，默认 fail-open 继续出 M1 结果；需要质量门的 CI 无法选择「引擎异常即失败」。

G6 只解决**引擎进程级 fail-open 可观测**；单文件超时、大小/内存上限、`--concurrency` 属 M5 G5，不在本 change。

## 目标与非目标

- 目标：
  - 明确状态归因：`missing`（显式/探测二进制不存在）、`crashed`（存在但 spawn 失败/exit≠0/**协议损坏**）、`timeout`（进程超时）、`degraded`（规则面缺失）、`ok`。
  - 引擎进程超时：默认 30s，`LINTSIGHT_ENGINE_TIMEOUT_MS` 可覆盖（`0` 关闭），超时 kill 并标 `timeout`。
  - 所有非 `ok` 状态统一 `logger.warn`（含 `missing`），报告 `engineStatus` 保持可见。
  - 可选的 fail-closed：`--fail-closed` 时任一非 `ok` 状态 → exit 2，且**保留报告**（`engineStatus` 与 M1 诊断仍可见）。
  - 四组失败场景测试：missing / crashed / protocol / timeout；golden 的 `engineStatus` 随 missing 语义更新。
- 非目标：
  - 不做引擎自动重试/回退到其它引擎、不做跨进程健康检查。
  - 不做单文件超时、内存/并发上限（M5 G5）。
  - 不做平台告警/上报（scanner 职责，D4）。
  - 不新增 engineStatus 枚举值（协议损坏映射为 `crashed`，不引入第六态）。
  - 不改规则检测行为、指纹、message。

## 方案选型

| 议题 | 方案 | 取舍 | 结论 |
| --- | --- | --- | --- |
| 协议损坏状态 | A. 新增 `protocol` 第六态；B. 复用 `crashed` | A 破坏 G2 已发布的枚举与 SARIF/平台对账；B 语义合理（引擎进程已坏） | **采纳 B**，但单独加解析单测与场景证据 |
| missing 判定 | A. 保留「路径不存在 → spawn 失败 → crashed」；B. 显式路径不存在即 `missing` | A 无法区分未安装/坏了；B 与枚举语义一致 | **采纳 B** |
| timeout 默认 | A. 不设默认，只能显式开启；B. 默认 30s + env 覆盖 | A 状态仍不可达；B 能兜住挂死引擎，30s 远高于现有引擎耗时 | **采纳 B** |
| fail-closed 输出 | A. exit 2 + report null；B. exit 2 + 保留报告 | A 丢失 engineStatus 可观测性；B 平台能同时看到状态与 M1 结果 | **采纳 B**（需在契约中写明 exit 2 可带报告） |
| fail-closed 开关 | A. 配置项；B. CLI `--fail-closed` | A 改 config schema 面；B 与现有参数面一致，CI 直接传 | **采纳 B** |

## 影响面清单

- 代码面：
  - `packages/lintsight-cli/src/engine-bridge.ts`（resolveEngineBin 存在性、协议解析抽取、超时竞速）
  - `packages/lintsight-cli/src/pipeline.ts`（非 ok 告警、failClosed、report + exit 2）
  - `packages/lintsight-cli/src/cli.ts`（`--fail-closed`）
- 契约面：
  - `engineStatus` 的 missing/crashed 归因细化；`exit 2` 可携带 report（fail-closed 专用）
  - 新增环境变量 `LINTSIGHT_ENGINE_TIMEOUT_MS`、CLI `--fail-closed`
- 文档面：本 change、`execution-todo.md` G6、`upgrade-plan.md`（M4 契约补充）
- 测试面：`engine-bridge.test.ts`、pipeline/CLI 集成、`report-v3.json` golden 更新
- Rust：无改动

## Breaking Changes

- `OXLINT_ENGINE_BIN` 指向不存在路径：状态由 `crashed` 改为 `missing`，`degraded` 由 true 改为 false；golden `engineStatus` 同步更新。
- `--fail-closed` 为新增 opt-in；默认 fail-open 行为不变。
- fail-closed 的 exit 2 可携带 report；现有 exit 2 契约（输入错误/无文件）仍 report null，不受影响。
- 无规则文案/指纹变化。

## 验收标准

- `engine-bridge.test.ts` 四组：
  - missing：`OXLINT_ENGINE_BIN` 指向不存在路径 → status missing；
  - crashed：指向存在但不可执行的文件 → status crashed；
  - protocol：`parseEngineStdout('not json')` → protocolError，映射 crashed；
  - timeout：`awaitEngineExit` 对永不退出进程在 timeoutMs 后返回 timeout。
- pipeline：非 ok 状态均有 warn；fail-open 默认 exit 0/1 不变；`failClosed=true` 时 exit 2 且 report 非空、`engineStatus` 正确。
- CLI：`--fail-closed` 与 `--output` 组合 exit 2 仍写文件；无 `--fail-closed` 行为不变。
- golden：`report-v3.json` 的 `engineStatus` 更新为 `missing`，其余字段无漂移。
- `bun run test` / `cargo test --release` / `lint` / `format:check` 全绿；`corpus:check` 不改检测面，漂移只归因、不 `--save`。
