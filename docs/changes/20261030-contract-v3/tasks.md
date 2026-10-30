# Tasks: G2 诊断契约 v3

> change-id：`20261030-contract-v3` · 按依赖排序；每项完成后勾选，最后走 `verification.md`。
> 实现前需用户确认本方案；未确认禁止改代码面。

- [x] **任务 1：诊断模型 v3 + 注册表 cweTags + 抑制解析器**
  - 涉及文件：`packages/lintsight-diagnostic/src/index.ts`、`src/registry.ts`、新增 `src/suppression.ts`
  - 内容：
    - `CONTRACT_VERSION='3'`；`LintsightDiagnostic` 增加 `confidence` / `cweTags` / `suppression?`；
    - `confidence` 解析链 = finding 覆盖 → registry → `medium`；`refreshDiagnosticMetadata` 供水合；
    - registry 增加 `cweTags`（JS 安全规则 16 条 + engine 6 条；架构/循环/深导入为空）；
    - 抑制指令解析纯函数（合法/缺 reason/缺 ruleId/未知规则/多指令）。
  - 验收点：`diagnostic.test.ts` 新增 v3 字段与解析用例；`registry.test.ts` 校验 JS cweTags 与插件 meta 一致；`bun run build:rules && bun test packages/lintsight-diagnostic`。

- [x] **任务 2：engineStatus 五态（engine-bridge）**
  - 涉及文件：`packages/lintsight-cli/src/engine-bridge.ts`
  - 内容：
    - `EngineStatus` 类型与 `deriveEngineStatus` 纯函数（missing > timeout > crashed > degraded > ok）；
    - `runEngine` 返回 `status`；`degraded` = `degraded|crashed|timeout`；
    - `EngineDiagnostic` 预留可选 `confidence`（Rust 本轮不发送）。
  - 验收点：`engine-bridge.test.ts` 五态映射；missing（bin=null）与 crashed（不存在 env bin）路径；既有 degraded 用例兼容。

- [x] **任务 3：pipeline 报告 v3（toolVersion / engineStatus / 抑制 / 水合 / fail-on）**
  - 涉及文件：`packages/lintsight-cli/src/pipeline.ts`、`src/cache.ts`
  - 内容：
    - `LintsightReport` 增加 `toolVersion`、`engineStatus`、`summary.suppressed`；
    - 缓存命中后 `refreshDiagnosticMetadata`；抑制在 `suppressSuperseded` 后应用；
    - summary / exit / `--fail-on` 只算未抑制 error；`failOn` 选项缺省 `low`。
  - 验收点：新增 `suppression.test.ts`（合法/非法/.vue/引擎诊断/冷热一致）、`fail-on.test.ts`（medium vs high/抑制/默认）；`bun test packages/lintsight-cli/test/{suppression,fail-on}.test.ts`；既有 cache/closed-loop 回归。

- [x] **任务 4：CLI 参数面（--fail-on / --output stdout 静默）**
  - 涉及文件：`packages/lintsight-cli/src/cli.ts`
  - 内容：解析 `--fail-on high|medium|low`（非法 exit 2）；有 `--output` 时只落文件、不写 stdout。
  - 验收点：新增 `cli-output.test.ts`（spawn CLI：`--output` stdout 为空、文件 JSON 可解析；无 `--output` stdout 有报告；`--fail-on high` 放行 medium error）。

- [x] **任务 5：formatter / SARIF v3**
  - 涉及文件：`packages/lintsight-formatter/src/index.ts`、`src/sarif.ts`
  - 内容：JSON 透传 v3 字段；SARIF `taxonomies`/`taxa`、`properties.confidence`、`suppressions`、`rules[].properties.cweTags`；text 摘要含 suppressed。
  - 验收点：`sarif.test.ts` 新增 taxonomy/properties/suppressions 快照；`formatter.test.ts` 回归。

- [x] **任务 6：golden 与契约断言迁移**（`.oxfmtrc.jsonc` 增加 `__golden__` 忽略：golden 由 `formatJson` 逐字节生成，格式化会破坏快照）
  - 涉及文件：`packages/lintsight-cli/test/report-snapshot.test.ts`、`__golden__/report-v2.json` → `report-v3.json`、`closed-loop.test.ts`
  - 内容：golden 固定 `OXLINT_ENGINE_BIN` 为不存在路径（`engineStatus='crashed'` 环境无关）；contractVersion 断言升 3；summary 含 suppressed。
  - 验收点：删除旧 golden 后重生成并人工 review diff；`bun test packages/lintsight-cli/test/{report-snapshot,closed-loop}.test.ts`。

- [x] **任务 7：全量验证、scanner 证据与状态同步**（scanner 签字按用户约定待补，未伪造）
  - 涉及文件：`docs/upgrade/v0.1/upgrade-plan.md`（契约章节）、`execution-todo.md`、`.agents/memory/decisions.md`、本 change 目录
  - 内容：
    - 实现前先在 `upgrade-plan.md` 补契约 v3 章节（schema 字段/SARIF/exit 语义）；
    - 跑 `bun run test`、`cargo test --release`、`lint`、`format:check`、`corpus:check`（不改检测面，漂移只归因不 `--save`）；
    - scanner 消费确认：外部签字可后补；未签字前 G2 状态保持 `[~]`，但代码与本地验收完成后可进入评审；
    - `proposal.md` 状态改为「已实现」；`execution-todo.md` G2 写证据与 pending scanner 签字。
  - 验收点：命令输出摘要齐全；golden diff 可解释；G2 证据含测试名/命令/SARIF 快照路径；不伪造 scanner 签字、不宣称 M4 Exit Gate 通过。
