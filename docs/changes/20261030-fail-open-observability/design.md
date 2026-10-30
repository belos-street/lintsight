# Design: G6 fail-open 可观测

> change-id：`20261030-fail-open-observability` · 日期：`2026-10-30`

## 技术设计

### 1. 状态归因（复用 G2 五态，不新增枚举）

| 场景 | 判定 | status | degraded |
| --- | --- | --- | --- |
| 未配置引擎 / 探测链无二进制 | `resolveEngineBin` 返回 null | `missing` | false |
| `OXLINT_ENGINE_BIN` 指向不存在路径 | 显式路径不存在 → 视为未安装 | `missing` | false |
| 二进制存在但 spawn 失败（权限/格式） | spawn catch | `crashed` | true |
| 进程 exit ≠ 0 | `proc.exited` ≠ 0 | `crashed` | true |
| 进程 exit 0 但 stdout 非 JSON | 协议解析失败 | `crashed` | true |
| 进程超时 | timeout 竞速 | `timeout` | true |
| summary 缺常驻规则 | `missingEngineRules > 0` | `degraded` | true |
| 正常 | 其余 | `ok` | false |

`resolveEngineBin` 调整：

```ts
const explicit = process.env.OXLINT_ENGINE_BIN
if (explicit) return existsSync(explicit) ? explicit : null
```

- 显式路径无效**不回退**仓库自带的二进制（避免偷偷换引擎），直接按 `missing`。
- 其余候选保持 `existsSync` 探测。

### 2. 协议解析抽取（让「协议损坏」可独立验证）

把 stdout 解析从 `runEngine` 抽成纯函数：

```ts
export interface ParsedEngineOutput {
  diagnostics: EngineDiagnostic[]
  summary: { version?: string; rules: string[] } | null
  protocolError: boolean
}
export function parseEngineStdout(stdout: string): ParsedEngineOutput
```

- 任一行非 JSON → `protocolError=true`（不再依赖 spawn 失败路径）。
- `runEngine` 在 `protocolError` 时返回 `{ diagnostics: null, degraded: true, status: 'crashed' }`。
- 单测可直接喂 `"not json"` / 混合合法行 + 损坏行。

### 3. 引擎进程超时（必须与流读取同时竞速）

```ts
export const DEFAULT_ENGINE_TIMEOUT_MS = 120_000
// pipeline 读取 env：
// LINTSIGHT_ENGINE_TIMEOUT_MS 为正整数 → 覆盖；0 → 禁用超时；非法 → 用默认并 warn
```

> 默认 120s：M5 目标是 10 万行 <60s，30s 会在目标规模一半处误杀；120s 是 2 倍裕度。CI 可显式调小。

实现必须**同时 race 三件事**，不能先读完 stdout/stderr 再等 exit。抽成可测试助手：

```ts
export async function awaitEngineProcess(
  proc: { exited: Promise<number>; stdout: ReadableStream; stderr: ReadableStream; kill: () => void },
  timeoutMs: number
): Promise<{ kind: 'exited'; stdout: string; stderr: string; code: number } | { kind: 'timeout' }>

const timed = (async () => {
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited
  ])
  return { kind: 'exited' as const, stdout, stderr, code }
})()

const timeout = sleep(timeoutMs).then(() => ({ kind: 'timeout' as const }))
const first = await Promise.race([timed, timeout])

if (first.kind === 'timeout') {
  try { proc.kill() } catch { /* kill 失败仍按 timeout 处理 */ }
  // 宽限：再等 exit + 流关闭，避免僵尸/测试卡死；上限 2s
  await Promise.race([timed, sleep(2_000)])
  return { diagnostics: null, degraded: true, status: 'timeout' }
}
```

- 超时路径不再读取半截输出（诊断置 null）；stdout/stderr 已被 `Promise.all` 消费，kill 后不会阻塞。
- `kill()` 抛异常也返回 `timeout`，不得降级成 `crashed`。
- `timeoutMs=0` 不创建定时器（禁用）。
- 测试必须覆盖「进程忽略 kill / exited 永不 resolve」：用 fake proc（`exited: new Promise(() => {})`、`kill` 抛错、流不关闭）调用 `awaitEngineProcess`，断言 10ms 检测到超时、≤2s 宽限内返回 timeout 且不悬挂（测试上界 3s）。
- **不**做单文件/内存/并发上限（G5）。

### 4. 统一非 ok 告警

pipeline 在 `runEngine` 返回后：

```ts
if (engineResult.status !== 'ok') {
  logger.warn(`engine: status=${engineResult.status}（fail-open，本轮为纯 M1 结果）`)
}
```

- `missing / crashed / timeout / degraded` 全部可见；具体失败细节仍由 engine-bridge debug/stderr 承载。
- 报告 `engineStatus` 始终写入，即使 fail-open。

### 5. fail-closed（CI 可选）

- pipeline 选项 `failClosed?: boolean`；CLI `--fail-closed`（布尔，无值）。
- 判定：`failClosed && engineResult.status !== 'ok'` → exit 2。
- **保留报告**：返回 `{ exitCode: 2, error: 'engine fail-closed: status=...', report }`；报告含 `engineStatus` 与 M1/缓存诊断。
- 默认 fail-open：exit 仍由诊断决定（0/1），报告不变。
- 现有 exit 2 路径（输入不存在/无文件/oxlint 运行失败）仍 report null；fail-closed 是唯一「exit 2 + report」形态，需在契约章节写明。
- `degraded` 字段保持 G2 语义：`degraded|crashed|timeout` 为 true，`missing` 为 false；fail-closed 判断用 `status !== 'ok'`，不依赖 `degraded`。

### 6. CLI

```text
usage: ... [--fail-closed]
```

- `args.includes('--fail-closed')` → `failClosed: true`；不影响 paths 解析。
- 无值校验（与 `--fix` 同形态）。
- CLI 在 `result.report` 存在时照常格式化；`--output` 仍只写文件且 stdout 为空；exit 2 由 `process.exit` 返回。
- 失败原因通过 `logger.error(result.error)` 走 stderr。
- usage 注明：`--fail-closed` 与 `--fix` 组合时，引擎异常会 exit 2，但已完成的 fix 改写不回滚。

### 7. SARIF 承载 engineStatus

G6 让 SARIF 消费面也能看到引擎状态：

```jsonc
runs[0].invocations[0] = {
  "executionSuccessful": engineStatus === "ok",
  "properties": { "engineStatus": "missing" }
}
```

- 仅当报告带 `engineStatus` 时输出；`ok` → `executionSuccessful: true`，其余四态 false。
- 这是 SARIF 2.1.0 标准字段（invocation），不写 schema 外属性。
- JSON/text 仍以报告级 `engineStatus` 为准；`--output` 静默、exit 语义不变。

### 8. fail-closed 与 scanner 契约

-「exit 2 + report」是新增形态，G6 验收必须包含 **scanner 消费确认**：
  - scanner 不得因 exit 2 丢弃 report；
  - 需读取 `engineStatus` 并在任务界面/门禁中体现；
  - 未签字前 G6 状态保持 `[~]`（与 G2 scanner 签字同纪律）。
- 默认 fail-open 路径的 exit 2 仍 report null，不变。

### 9. 缓存与指纹

- `engineStatus` 不进缓存（报告级、每轮重算）。
- engine 指纹中 `engine@<bin 内容哈希|none>` 已覆盖二进制变化；timeout/status 不影响缓存条目。
- 引擎 fail-open 时 M1 缓存照旧写；恢复后引擎结果重算（G1/D11 已保证）。

## 涉及文件清单

- 改动：`packages/lintsight-cli/src/engine-bridge.ts`
- 改动：`packages/lintsight-cli/src/pipeline.ts`
- 改动：`packages/lintsight-cli/src/cli.ts`
- 改动：`packages/lintsight-formatter/src/sarif.ts`（invocations.engineStatus）
- 改动（测试）：`packages/lintsight-cli/test/engine-bridge.test.ts`
- 改动（测试）：`packages/lintsight-formatter/test/sarif.test.ts`（invocations）
- 新增（测试）：`packages/lintsight-cli/test/fail-closed.test.ts`
- 改动（golden）：`packages/lintsight-cli/test/__golden__/report-v3.json`（engineStatus crashed → missing）
- 改动（测试）：`packages/lintsight-cli/test/cache.test.ts`（G1「降级不毒化」用例的 missing/degraded 断言同步）
- 文档：`docs/upgrade/v0.1/execution-todo.md`、`docs/upgrade/v0.1/upgrade-plan.md`、本 change
- Rust：无改动

## 测试计划

| 场景 | 测试 | 断言 |
| --- | --- | --- |
| missing | `OXLINT_ENGINE_BIN` 指向不存在路径 → `runEngine` | status `missing`、degraded false、diagnostics null |
| crashed | `OXLINT_ENGINE_BIN` 指向存在但不可执行的文件 | status `crashed`、degraded true |
| protocol | `parseEngineStdout('not json')` / 坏行混排 | protocolError true；runEngine 映射 crashed |
| timeout | `awaitEngineExit(fakeProc, 10)`（exited 永不 resolve） | 返回 timeout、kill 被调用 |
| fail-open 默认 | pipeline + missing 引擎 | exit 0/1 由诊断决定，report.engineStatus=missing，日志 warn |
| fail-closed | pipeline `failClosed:true` + missing/crashed/timeout | exit 2、report 非空、error 含 status |
| CLI | `--fail-closed --output` + missing 引擎 | exit 2、stdout 为空、输出文件含 engineStatus=missing |
| golden | `report-v3.json` | engineStatus=missing，其余字段无漂移 |
| 回归 | cache/closed-loop/engine-bridge 既有用例 | 全绿 |

命令：

- `bun test packages/lintsight-cli/test/{engine-bridge,fail-closed,report-snapshot,cache}.test.ts`
- `bun run test`
- `cargo test --release --manifest-path crates/lintsight-engine/Cargo.toml`
- `bun run lint` / `bun run format:check`
- `bun run corpus:check`（不改检测面；漂移只归因、不 `--save`）

## 风险与已知坑

1. **missing 语义变更**：`OXLINT_ENGINE_BIN` 无效从 crashed 改为 missing；golden 与 G1 降级用例同步更新。平台若按旧口径统计 crashed 会看到一次迁移。
2. **默认 120s 超时**：给 M5 的 10 万行 <60s 目标留 2 倍裕度；更大仓库仍可能超时，平台可设 `LINTSIGHT_ENGINE_TIMEOUT_MS`；G6 不解决吞吐，只兜挂死。
3. **timeout kill 的平台差异**：Windows kill 后仍需等待进程退出；`awaitEngineProcess` 对 kill 后的 exit/流关闭加 2s 宽限，避免测试/CI 卡死。
4. **protocol 仍映射 crashed**：不新增枚举，平台无法区分「协议坏」与「进程坏」；失败细节进 stderr/debug 日志。若平台需要区分，后续单独评审。
5. **exit 2 + report 的新形态**：scanner 若假定 exit 2 必无报告需调整；本 change 只在 fail-closed 生效，默认路径不变。
6. **`--fail-closed` 与 `--fix`**：fix 模式同样生效；引擎异常时 exit 2 但文件可能已被 fix 改写（与现有 fix 语义一致，需文档说明）。
7. **不做 G5**：单文件超时、内存上限、并发上限仍归 M5；G6 验收不得写成资源有界。
