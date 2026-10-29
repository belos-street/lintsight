# Workflow: rule-change（规则新增 / 修改 / 删除）

> 适用：JS 轨道 `lintsight/*`、Rust 轨道 `lintsight-engine/*` 的规则变更。先读 `.agents/skills/rule-authoring/SKILL.md`。

## 步骤

1. **需求溯源**：规则必须挂在 FR 编号、CWE/OWASP 家族或升级计划条目下；没有依据不写规则。
2. **检测层选型**：`none` / `local` / `taint`；需要跨文件类型事实的映射到 oxlint `--type-aware`，不自实现。
3. **规则提案**：ruleId、category、severity、confidence、CWE/OWASP、falsePositives、fixtures、语料与指纹影响；写入 `docs/changes/<change-id>/proposal.md`。
4. **spec-first 闸门**：规则行为/文案/默认启用/注册表变化 → 出三层文档并停下等确认。
5. **用例先行**：≥3 bad / ≥2 good / safe case / 边界矩阵；RuleTester 或 cargo 单测先失败。
6. **实现**：
   - JS 轨道：`packages/rules-core/src/rules/*.js`，只走 ESLint 兼容 API；
   - Rust 轨道：`crates/lintsight-engine/src/rules.rs` + taint 表；
   - 同步 `packages/lintsight-diagnostic/src/registry.ts`；
   - 默认启用/预设变化同步 `builtin-mapping.ts`。
7. **语料门禁**：`bun run corpus:check`；召回相关 `bun run corpus:recall`；误报分析随变更文档提交；基线变更逐条归因后 `--save`。
8. **指纹与 golden**：message/messageId 变更 = breaking；golden/SARIF diff 必须评审后更新。
9. **验证**：`bun run test` + 目标 RuleTester；Rust 规则加 `cargo test --release`；`bun run lint` / `format:check`。
10. **复盘与提交**：规则边界/误报教训写入 `decisions.md` 或规则 `falsePositives`；提交带 change-id。

## 关键闸门

- 没有 fixtures → 未完成；
- security 规则没有 CWE/OWASP tag → 不登记；
- 语料误报超门禁且无评审记录 → 不合入；
- 改实现不改用例 = 没改对；放宽断言必须在变更文档说明。
