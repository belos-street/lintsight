# Tasks: G12 默认 recommended/security 预设

> change-id：`20261102-default-preset` · 按依赖排序；每项完成后勾选，最后走 `verification.md`。
> **实现前需用户确认本方案；未确认前禁止改代码面。**

- [x] **任务 1：registry 增加 category 与计数基线**
  - 涉及文件：`packages/lintsight-diagnostic/src/registry.ts`、`packages/lintsight-diagnostic/test/registry.test.ts`
  - 内容：`RegistryEntry` 增 `category`；27 条 JS 按 11 correctness / 16 security 登记；9 条 engine 补 category；registry.test 扩展“category 与规则 meta 一致”断言。
  - 验收点：`bun test packages/lintsight-diagnostic/test/registry.test.ts`；计数断言 11/16。

- [x] **任务 2：preset schema + 展开 + translate 合并**
  - 涉及文件：`packages/lintsight-config-bridge/src/index.ts`、新增 `packages/lintsight-config-bridge/src/presets.ts`、`packages/lintsight-config-bridge/test/config-bridge.test.ts`
  - 内容：`LintsightConfig.preset`（recommended/security/none，缺省 recommended）；`validateConfig` 非法值 errors；`expandPreset()` 按 registry 派生；`translate()` 合并顺序 builtin → preset → 用户 rules → overrides；等价报告新增 `preset` 行。
  - 验收点：`bun test packages/lintsight-config-bridge/test/config-bridge.test.ts`；缺省/三档/非法值/显式覆盖/none 用例全绿。

- [x] **任务 3：1b 内置清单 + dead-rule 防呆**
  - 涉及文件：`packages/lintsight-config-bridge/src/presets.ts`、`packages/lintsight-config-bridge/test/preset-snapshot.test.ts`
  - 内容：按 design §5 落地 **9 条**可用规则（`eslint/no-await-in-loop` 因 corpus +420 warning 移出，待 perf/strict 预设）；security 预设提升安全项；显式排除 `no-unsafe-finally`/`react/no-danger`/`react/no-danger-with-children`/`typescript/no-misused-promises`。
  - dead-rule：spawn `oxlint --rules`，解析 `rule name | source` 两列，按 **source+name** 匹配（`eslint/no-new-func` → `no-new-func|eslint`；`promise/catch-or-return` → `catch-or-return|promise`；`unicorn/no-document-cookie` → `no-document-cookie|unicorn`）；注入伪造 key 必须红。
  - 验收点：`preset-snapshot.test.ts` 全绿；合成不存在 key（`eslint/no-such-rule-g12-probe`）自测红一次；对照 `react/no-danger` 存在但不在预设。

- [x] **任务 4：空配置/无 config E2E 与 fail-on 语义**
  - 涉及文件：新增 `fixtures/preset/*`、新增 `packages/lintsight-cli/test/preset-e2e.test.ts`
  - 内容：`{"rules":{}}` 项目扫描坏样本（硬编码凭证 / new Function / document.cookie / switch fallthrough）→ 安全诊断；**无 config 项目仍只有 oxlint correctness + 引擎 6 条**（显式断言无 `lintsight/*` 诊断）；`preset:"none"` → 自有规则 0 诊断；low confidence 命中时 `failOn:'high'` exit 0、`failOn:'low'` exit 1。
  - 验收点：`bun test packages/lintsight-cli/test/preset-e2e.test.ts`；报告 ruleId/severity 断言。

- [x] **任务 5：rule-count 三口径脚本与快照**
  - 涉及文件：新增 `scripts/rule-count.ts`、`scripts/rule-count.test.ts`、`package.json`
  - 内容：`registered` / `enabled`（own+builtin）/ `effective` = enabled + engineResident 6；默认读仓库 `lintsight.config.json`，支持 `--config`；输出便于评审的文本/JSON。
  - 验收点：`bun run rule-count` 输出 recommended = 27+9+6=**42**、none = **6**（G9 后 44）；`rule-count.test.ts` 快照规则 ID/severity。

- [x] **任务 6：dogfood 配置 + golden/corpus 归因**
  - 涉及文件：`lintsight.config.json`、`packages/lintsight-cli/test/__golden__/report-v3.json`、`corpus/baseline-v0.json`
  - 内容：仓库 config 显式 `"preset": "recommended"`；跑全量测试观察 golden diff；跑 `corpus:check` 收集 1b 新增诊断，按 rule/file 逐条归因；评审后更新 golden 并 `corpus:check -- --save`。
  - 验收点：golden diff 有逐条说明；`corpus:check` 通过；不得自动保存基线。

- [x] **任务 7：全量验证与文档/状态同步**
  - 涉及文件：`README.md`、`docs/upgrade/v0.1/execution-todo.md`、`docs/upgrade/v0.1/upgrade-plan.md`（确认后修订 11）、本 change、`.agents/memory/decisions.md`
  - 内容：`bun run test`、`bun run lint`、`bun run format:check`、`cargo test --release`、`corpus:check`；更新 G12 状态/证据；README/发布说明明确：preset 仅在存在 config 时生效、无 config 行为不变、`preset:"none"` 回退、`--fail-on low` 会拦 low confidence、`react/no-danger` 存在但默认未启用且需 plugins。
  - 验收点：证据含命令摘要与快照路径；README 无「所有项目默认开启」的误导表述。

## 依赖与顺序

- 建议 **G12 → G9**：G12 先落 preset/registry/count；G9 新增 2 条 JSX 规则后，预设自动纳入，再更新快照 27→29 与 corpus。
- 若用户要求 G9 先行：G9 需在仓库 config 显式登记新规则，并单独跑 corpus 门禁；G12 的快照直接按 29 条建立。

## 实现证据（2026-11-02）

- `bun run test`：**254 pass / 0 fail**；`bun run lint` 0/0；`bun run format:check` clean；`cargo test --release` 52 passed。
- preset 快照：`preset-snapshot.test.ts` 5 pass（27+9；security 16 条 error；none；显式覆盖；非法值）。
- dead-rule：`preset-dead-rules.test.ts` 1 pass；按 `rule name | source` 匹配；合成 `eslint/no-such-rule-g12-probe` 判 missing；`react/no-danger` 存在但不在预设。
- E2E：`preset-e2e.test.ts` 4 pass（`{}` 出安全诊断；无 config 无自有/1b；none；low confidence `failOn high` exit 0 / `low` exit 1）。
- `bun run rule-count`：`registered js=27 (11/16) engine=9`；`enabled own=27 builtin=9`；`effective 27+9+6=42`。
- golden：新增 2 条（`eslint/array-callback-return` error 于 `no-array-map-side-effect.good-2.ts`；`eslint/no-proto` error 于 `no-prototype-pollution-syntax.bad-1.ts`），summary error 74→76。
- corpus：3433 diagnostics（3392 → +41）；双报率 0；逐条归因：`no-new-func +1`、`no-promise-executor-return +2`、`no-proto +5`、`no-prototype-builtins +23`、`no-throw-literal +9`、`no-document-cookie +1`；`no-await-in-loop +420` 经门禁移出预设。基线已评审 `--save`。
