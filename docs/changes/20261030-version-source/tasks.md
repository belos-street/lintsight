# Tasks: G14 单一版本源

> change-id：`20261030-version-source` · 按依赖排序；每项完成后勾选，最后走 `verification.md`。
> 实现前需用户确认本方案；未确认禁止改代码面。

- [ ] **任务 1：运行时统一读根版本**
  - 涉及文件：`packages/lintsight-cli/src/cli.ts`、`src/pipeline.ts`
  - 内容：`--version` / `toolVersion` 改为导入根 `package.json`；移除对 CLI 包版本的运行时依赖。
  - 验收点：`bun run cli -- --version` 输出根版本；JSON `toolVersion` 一致。

- [ ] **任务 2：对齐 CLI 包与 Cargo 版本**
  - 涉及文件：`packages/lintsight-cli/package.json`、`crates/lintsight-engine/Cargo.toml`
  - 内容：两处版本改为根 `0.1.0-alpha.0`；无 Rust 代码改动。
  - 验收点：`cargo test --release` 通过；engine summary 版本与根一致。

- [ ] **任务 3：version:check 脚本 + CI 挂钩**
  - 涉及文件：新增 `scripts/version-check.ts`、根 `package.json`
  - 内容：校验根/CLI/Cargo；不等 exit 1；脚本 check-only。
  - 验收点：`bun run version:check` 输出三载体版本；人为漂移（测试临时文件/解析函数）能报错；CI 阶段（G3）调用。

- [ ] **任务 4：测试与 golden 更新**
  - 涉及文件：新增 `packages/lintsight-cli/test/version-consistency.test.ts`、`__golden__/report-v3.json`
  - 内容：三载体一致性、SARIF driver.version、CLI `--version`；golden `toolVersion` 更新。
  - 验收点：`bun test packages/lintsight-cli/test/version-consistency.test.ts`；golden diff 仅 toolVersion。

- [ ] **任务 5：全量验证与文档同步**
  - 涉及文件：`docs/upgrade/v0.1/execution-todo.md`、`upgrade-plan.md`、本 change
  - 内容：跑 `bun run test`、`version:check`、`lint`、`format:check`、`cargo test --release`；记录发布检查清单。
  - 验收点：命令摘要齐全；无规则文案/指纹变化；不宣称 G11 发布自动化完成。
