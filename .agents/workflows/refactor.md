# Workflow: refactor（重构 / 架构调整）

> 适用：结构调整、目录迁移、模块解耦、技术债清理。由 `workflow-guide.md` 路由。

## 步骤

1. **范围与不变量**：明确重构边界、行为不变/性能/可维护性目标；列出不能变的契约（ruleId、指纹、JSON/SARIF、exit code、引擎协议）。
2. **三层文档（必走 spec-first）**：产出 `docs/changes/<change-id>/`，影响面覆盖 packages/crates/plugins/fixtures/docs；停下等确认。
3. **行为基线**：先跑现有测试/golden/corpus 作为基线；必要时补行为用例再重构。
4. **分步迁移**：每步独立可验证；`bun run test`/`cargo test` 保持绿；不混入功能改动。
5. **同步引用**：AGENTS、rules/workflows、upgrade-plan/execution-todo、注册表、文档索引；路径迁移用 `git mv`。
6. **质量验证**：全量测试 + lint/format；性能/架构变化跑 bench；规则/引擎变化跑 corpus。
7. **code-review**：对 diff 走 `belos-street`；架构评审可叠加 `sast-review`。
8. **决策沉淀**：结构性结论追加 `decisions.md`；变更记录归档 `docs/changes/`。
9. **提交**：`refactor:` 前缀；复杂变更带 change-id；推 dev 分支。

## 关键闸门

- 步骤 2 未确认 → 禁止动码；
- 行为不变：diff 中不得出现与重构无关的功能改动；
- 契约变化必须先更新计划/契约文档，再改实现。
