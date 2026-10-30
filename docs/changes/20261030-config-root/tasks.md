# Tasks: G13 配置根与路径契约

> change-id：`20261030-config-root` · 按依赖排序；每项完成后勾选，最后走 `verification.md`。
> 实现前需用户确认本方案；未确认禁止改代码面。

- [ ] **任务 1：pipeline 引入 root 并贯通全部路径基准**
  - 涉及文件：`packages/lintsight-cli/src/pipeline.ts`
  - 内容：`runPipeline` 增加 `root?: string`；配置/缓存/输入/ignore/tsconfig/Vue/诊断/抑制/引擎 spawn 全部改用 root；根外输入 warning。
  - 验收点：现有测试全绿；新增外部根用例先以 `runPipeline` 直接驱动（不依赖 CLI）。

- [ ] **任务 2：config-bridge 显式根解析**
  - 涉及文件：`packages/lintsight-config-bridge/src/index.ts`
  - 内容：`resolveConfigFile(root, config)` 语义确认；`--config` 相对 root；不改变默认 cwd 形态。
  - 验收点：`config-bridge.test.ts` 回归 + 嵌套 config 用例。

- [ ] **任务 3：CLI --root**
  - 涉及文件：`packages/lintsight-cli/src/cli.ts`
  - 内容：解析 `--root <dir>`（缺值 exit 2）；传入 pipeline；usage 更新。
  - 验收点：`config-root.test.ts` 增加 CLI spawn：外部绝对路径 + `--root`，报告 file 相对、无盘符前缀；`--root` 缺值 exit 2。

- [ ] **任务 4：外部路径/嵌套 config/ignore 回归矩阵**
  - 涉及文件：`packages/lintsight-cli/test/config-root.test.ts`、`test/ignore.test.ts`
  - 内容：三组主用例 + ignore/Vue/缓存落点断言；报告 `file` 不含 `C:/`、`/Users/`。
  - 验收点：`bun test packages/lintsight-cli/test/{config-root,ignore,closed-loop}.test.ts` 全绿。

- [ ] **任务 5：全量验证、证据与状态同步**
  - 涉及文件：`docs/upgrade/v0.1/execution-todo.md`、`upgrade-plan.md`、本 change
  - 内容：跑 `bun run test`、`cargo test --release`、`lint`、`format:check`、`corpus:check`；记录外部路径证据；scanner 传参签字可后补。
  - 验收点：命令输出摘要齐全；G13 证据含测试名/报告路径断言；不伪造 scanner 签字。
