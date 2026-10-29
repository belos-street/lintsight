# Workflow: feature-development（新功能 / 新引擎能力）

> 适用：新功能、新引擎能力、新框架 profile、新 formatter、新诊断字段。规则新增/修改走 `rule-change.md`。

## 步骤

1. **需求澄清**：明确目标、非目标、验收标准；含糊时先用 `grill-me` 或直接提问。
2. **读项目事实**：`.agents/memory/decisions.md`、`docs/upgrade/v0.1/upgrade-plan.md`、`execution-todo.md`、相关 requirements/design/spike。
3. **复杂度判断（spec-first）**：3+ 代码文件 / 跨模块 / 协议/契约/指纹变化 → 产出 `docs/changes/<change-id>/` 三层文档并停下等确认。
4. **用例先行**：规则用 RuleTester/fixtures；引擎用 cargo 单测；契约用 golden/SARIF 快照。先写失败用例，再实现。
5. **按 tasks.md 实现**：最小改动；同步注册表、配置、文档；不夹带无关重构。
6. **质量验证**：
   - `bun run test`
   - `cargo test --release --manifest-path crates/lintsight-engine/Cargo.toml`
   - `bun run lint`、`bun run format:check`
   - 规则/引擎行为变化：`bun run corpus:check`；召回相关：`bun run corpus:recall`
   - 性能相关：`bun run bench`（不可用则说明）
7. **范围核对 + code-review**：对照 design.md 的影响面清单；对 diff 走 `belos-street` 代码审查；引擎/契约变更可叠加 `sast-review`。
8. **文档与状态**：更新 `docs/upgrade/v0.1/execution-todo.md` 状态；契约/计划变化先改 `upgrade-plan.md`。
9. **复盘沉淀**：按 `memory.md` 三问；新决策追加 `decisions.md`。
10. **提交**：按 `git-commit-message.md` 原子提交；复杂变更带 change-id；推 dev 分支，不直接推 main。

## 关键闸门

- 步骤 3 未确认 → 禁止改代码面；
- 步骤 6 未通过 → 不得提交；
- 规则/契约变更未补用例 → 视为未完成。
