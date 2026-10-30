# Tasks: G6 fail-open 可观测

> change-id：`20261030-fail-open-observability` · 按依赖排序；每项完成后勾选，最后走 `verification.md`。
> 实现前需用户确认本方案；未确认禁止改代码面。

- [ ] **任务 1：引擎状态归因 + 协议解析 + 超时（engine-bridge）**
  - 涉及文件：`packages/lintsight-cli/src/engine-bridge.ts`
  - 内容：
    - `resolveEngineBin`：`OXLINT_ENGINE_BIN` 指向不存在路径 → null（missing），不回退；
    - 抽取 `parseEngineStdout(stdout)` 纯函数，协议损坏 → `protocolError`，映射 crashed；
    - `DEFAULT_ENGINE_TIMEOUT_MS=120_000` 与 `awaitEngineProcess(proc, timeoutMs)`（exited + stdout + stderr 同时 race；kill 异常仍 timeout；2s 宽限兜底）；
    - `runEngine` 接受 `timeoutMs`，超时返回 status timeout。
  - 验收点：`engine-bridge.test.ts` 新增/更新 missing、crashed、protocol、timeout 四组；`bun test packages/lintsight-cli/test/engine-bridge.test.ts`。

- [ ] **任务 2：pipeline 非 ok 告警 + fail-closed**
  - 涉及文件：`packages/lintsight-cli/src/pipeline.ts`
  - 内容：
    - `LINTSIGHT_ENGINE_TIMEOUT_MS` 解析（正整数覆盖、0 禁用、非法 warn + 默认）；
    - 任一非 ok 状态统一 `logger.warn`（含 missing）；
    - `failClosed` 选项：非 ok → exit 2，保留 report（engineStatus + M1 诊断）。
  - 验收点：新增 `fail-closed.test.ts`（missing/crashed/timeout + fail-open 默认 + report 非空）；既有 cache/closed-loop 回归。

- [ ] **任务 3：CLI --fail-closed + SARIF invocations**
  - 涉及文件：`packages/lintsight-cli/src/cli.ts`、`packages/lintsight-formatter/src/sarif.ts`
  - 内容：usage 增加 `--fail-closed`（含与 `--fix` 组合的风险提示）；布尔开关透传 pipeline；`--output` 组合仍只落文件；SARIF `invocations[0].executionSuccessful` + `properties.engineStatus`。
  - 验收点：`fail-closed.test.ts` 增加 CLI spawn：`--fail-closed --output` + missing 引擎 → exit 2、stdout 为空、文件 engineStatus=missing；`sarif.test.ts` 断言五态 invocations。

- [ ] **任务 4：golden 与降级用例口径同步**
  - 涉及文件：`packages/lintsight-cli/test/__golden__/report-v3.json`、`report-snapshot.test.ts`、`cache.test.ts`
  - 内容：golden engineStatus 改为 missing（原 crashed）；G1「引擎降级不毒化」用例的 status/degraded 断言同步。
  - 验收点：`bun test packages/lintsight-cli/test/{report-snapshot,cache}.test.ts`；golden diff 仅 engineStatus 变化。

- [ ] **任务 5：全量验证、证据与状态同步**
  - 涉及文件：`docs/upgrade/v0.1/execution-todo.md`、`docs/upgrade/v0.1/upgrade-plan.md`、本 change 目录
  - 内容：
    - 跑 `bun run test`、`cargo test --release`、`lint`、`format:check`、`corpus:check`（漂移只归因不 `--save`）；
    - execution-todo G6 写证据（四组场景、fail-closed exit、golden 路径）；
    - upgrade-plan 契约补充「exit 2 可携带 report（fail-closed）」与超时 env；
    - proposal 状态改「已实现」；scanner 对「exit 2 + report」的签字确认是 G6 收口条件，未签字保持 `[~]`；不伪造签字、不宣称 G5 资源上限完成。
  - 验收点：命令输出摘要齐全；golden diff 可解释；G6 证据含测试名/命令/exit 语义。
