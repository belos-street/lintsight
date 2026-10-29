# Workflow: bug-fix（缺陷 / 误报 / 漏报）

> 适用：报障、误报、漏报、行为不符。由 `workflow-guide.md` 路由。

## 步骤

1. **复现**：先写最小复现（fixture/临时工程/命令），记录 ruleId、文件、行号、期望与实际；能写测试的先写失败测试。
2. **定位根因**：区分规则逻辑、taint/source-sink 表、框架 profile、缓存/增量、配置/路径、parser/版本问题；读 `decisions.md` 与相关 spike。
3. **复杂度判断（spec-first）**：3+ 代码文件或行为/契约变化 → 先出 `docs/changes/<change-id>/` 并等确认；单点修复直接进行。
4. **最小修复**：只改根因；不顺手重构/改无关规则；fixtures 与实现同步。
5. **回归验证**：
   - 目标测试/复现用例通过；
   - `bun run test` + 相关 `cargo test`；
   - 规则行为变化跑 `corpus:check`；
   - 缓存问题补冷/热扫等价；
   - 契约变化补 golden/SARIF。
6. **code-review**：对 diff 走 `belos-street`；安全规则问题叠加 `sast-review`。
7. **复盘沉淀**：误报补 safe fixture 与 `falsePositives`；漏报补 bad fixture；重要结论追加 `decisions.md`。
8. **提交**：`fix:` 前缀；复杂修复带 change-id；推 dev 分支。

## 关键闸门

- 未复现 → 不得动手改码；
- 修复 diff 必须全部可追溯到根因；
- 不得用放宽规则/删用例代替修复。
