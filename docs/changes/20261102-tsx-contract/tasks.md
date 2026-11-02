# Tasks: G9 TSX/JSX 契约（P0 语法面）

> change-id：`20261102-tsx-contract` · 按依赖排序；每项完成后勾选，最后走 `verification.md`。
> **实现前需用户确认本方案；未确认前禁止改代码面。**

- [x] **任务 1：fixtures 先行（规则契约）**
  - 涉及文件：新增 `fixtures/tsx/*.tsx`、`fixtures/jsx/*.jsx`、`fixtures/vue/jsx-sink.vue`
  - 内容：按 design §5 建立 bad/good 矩阵（dangerous-html、unsafe-url、语法基础用例、Vue tsx）；**必须包含大小写与前导空白变体**（` JaVaScRiPt:`、`DATA:`、`data:IMAGE/SVG+XML`）。
  - 验收点：fixture 行/列布局固定；`fixtures/tsx`、`fixtures/jsx` 不被全量 lint/format 误改；先写测试骨架 `jsx-sink.test.ts` 并允许红。

- [x] **任务 2：`no-jsx-dangerous-html` 实现与登记**
  - 涉及文件：`packages/rules-core/src/rules/no-jsx-dangerous-html.js`、`packages/rules-core/src/index.js`、`packages/lintsight-diagnostic/src/registry.ts`、`packages/lintsight-cli/test/jsx-sink.test.ts`
  - 内容：`JSXOpeningElement` 遍历 attributes；meta（security/error/medium/cwe-79）；registry 登记；RuleTester bad/good。
  - 验收点：`bun test packages/lintsight-cli/test/jsx-sink.test.ts` 中该规则用例全绿；`registry.test.ts` meta 对齐。

- [x] **任务 3：`no-unsafe-jsx-url` 实现与登记**
  - 涉及文件：`packages/rules-core/src/rules/no-unsafe-jsx-url.js`、`packages/rules-core/src/index.js`、`packages/lintsight-diagnostic/src/registry.ts`、`packages/lintsight-cli/test/jsx-sink.test.ts`
  - 内容：按 design §3.2 判定矩阵（字面量 javascript:/data:、安全 image MIME、**用户可控名称启发式**、**模板/二元拼接静态危险前缀 + cooked 转义**、锚定模板放行、spread/自定义组件边界、类型注解跳过）；**先 `trim().toLowerCase()`**；meta（security/warning/medium/cwe-79）；`docs.falsePositives` 写明 `url/payload/next/...` 漏报与类型注解边界。
  - 验收点：`jsx-sink.test.ts` 全绿；good 用例 0 诊断；`href={userInput}`、`href={req.query.next}`、`` `javascript:${payload}` ``、`'javascript:' + payload`、`` `\u006aavascript\u003a...` `` 精确命中。

- [x] **任务 4：pipeline / Vue / 引擎解析契约**
  - 涉及文件：`packages/lintsight-cli/test/jsx-sink.test.ts`、`packages/lintsight-vue-processor/src/index.ts`、`packages/lintsight-vue-processor/test/vue-processor.test.ts`、`crates/lintsight-engine/src/rules.rs`
  - 内容：`runPipeline(['fixtures/tsx','fixtures/jsx'], { cache:false })` 无 `internal/parse-error`、结果确定；`fixtures/vue/jsx-sink.vue` 回映射原路径；**修复 Vue lang 正则最长优先（tsx|ts|jsx|js），否则 `<script lang="tsx">` 被当作 .ts 解析失败**；Rust 新增 `.tsx` 路径测试（`SourceType` + `no-eval`）。
  - 验收点：`bun test .../jsx-sink.test.ts`、`bun test packages/lintsight-vue-processor/test/vue-processor.test.ts`、`cargo test --release --manifest-path crates/lintsight-engine/Cargo.toml`。

- [x] **任务 5：预设 / 计数联动（依赖 G12）**
  - 涉及文件：`packages/lintsight-config-bridge/test/preset-snapshot.test.ts`、`scripts/rule-count.test.ts`、`lintsight.config.json`
  - 内容：若 G12 已落地，new rules category=security 自动进入 recommended/security；更新快照 27→29、rule-count 42→44。若 G12 未落地，在仓库 config 显式登记两条规则以保证 corpus 可触发。
  - 验收点：preset 快照含两条规则；security 预设下 `no-unsafe-jsx-url` 为 error；`bun run rule-count` 计数更新。

- [x] **任务 6：golden / corpus 门禁与基线**
  - 涉及文件：`packages/lintsight-cli/test/__golden__/report-v3.json`、`corpus/baseline-v0.json`
  - 内容：删除 golden 重跑，逐条评审 `fixtures/vue/jsx-sink.vue` 新增诊断；跑 `corpus:check`，输出新规则命中清单（repo/file/case），抽样 FP；评审后 `--save`。
  - 验收点：golden diff 有逐条说明；corpus 双报率 0；security 抽样 FP <10%；不得自动保存。

- [x] **任务 7：全量验证与文档/状态同步**
  - 涉及文件：`docs/upgrade/v0.1/execution-todo.md`、`docs/upgrade/v0.1/upgrade-plan.md`（确认后修订 11）、本 change、`.agents/memory/decisions.md`
  - 内容：`bun run test`、`bun run lint`、`bun run format:check`、`cargo test --release`、`corpus:check`；更新 G9 证据与状态；记录 `react/no-danger` 存在但默认未启用（需 plugins）、H5 重叠处置、JSX spread 边界、动态 URL 范围。
  - 验收点：证据含命令摘要与报告路径；状态按实际，不宣称未完成的矩阵通过。

## 依赖与顺序

- 建议 **G12 → G9**（G12 先落 preset/registry/count；G9 规则自动纳入，快照一次更新 27→29、42→44）。
- 若 G9 先行：任务 5 必须显式登记两条规则；G12 实施时按其 registry 派生直接得到 29 条快照。

## 实现证据（2026-11-02）

- `bun run test`：**259 pass / 0 fail**；`bun run lint` 0/0；`bun run format:check` clean；`cargo test --release` **53 passed**（新增 `.tsx` 用例）。
- `jsx-sink.test.ts` 4 pass：两规则 `.tsx/.jsx` bad/good（含 ` JaVaScRiPt:`、`DATA:IMAGE/SVG+XML`、`req.query.next` 命中；route/config.url/routerLink 不报）；**模板/二元拼接静态危险前缀（bad-7..10）与 cooked 转义（bad-11）命中**；`safeValue as UserInput` 类型注解不误报（good-6）；url/payload/next/... 漏报边界锁定（good-7）；pipeline 无 parse-error + 重跑确定；Vue 回映射。
- `vue-processor.test.ts` 14 pass：新增 `lang=tsx/jsx` 最长优先用例；修复前 `<script lang="tsx">` 被误判为 `.ts` 导致 TSX parse-error。
- registry：JS 29（11 correctness / 18 security）；preset recommended 29+9、security 18 条 error；`bun run rule-count` = `29 + 9 + 6 = 44`。
- golden：files 149→150，warning 39→40；唯一新增 `lintsight/no-unsafe-jsx-url` on `fixtures/vue/jsx-sink.vue`。
- corpus：3463 diagnostics（3433 → +30，全部 `no-jsx-dangerous-html`）；`no-unsafe-jsx-url` 在名称启发式后 corpus 命中 **0**（修复前动态路由/配置 53 条会被误报）；双报率 0；基线已评审 `--save`。High 修复后 corpus 仍为 3463（模板/二元危险 scheme 在语料未新增命中）。
