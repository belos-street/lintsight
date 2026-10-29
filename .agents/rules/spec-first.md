---
name: spec-first
description: 复杂需求先出三层变更文档并等待确认，未确认禁止改代码；规则行为、引擎协议、指纹与契约变更均触发
alwaysApply: true
---

# 规范先行闸门（Spec First）

复杂需求必须「先出方案 → 等确认 → 再动码」。**未经用户确认，禁止创建/修改/删除代码面文件。**

## 一、代码面定义

`packages/**`、`crates/**`、`plugins/**`、`scripts/**`、`fixtures/**`（fixtures 是规则契约，按代码面管理）。
纯 `docs/**`、`.agents/**`、根级说明文档不触发本闸门，但仍需走 `verification`。

## 二、触发条件（满足任一）

1. **改变行为或契约（主判据）**：规则检测逻辑、ruleId、message/messageId、指纹、severity/confidence、source/sink/sanitizer 表、引擎协议、诊断 schema、缓存键、scanner 调用契约；
2. **跨模块**改动：JS 规则 + Rust 引擎表 + CLI/config/diagnostic/formatter 中至少两处；
3. 预计改动 **3+ 个代码文件且包含结构/行为变化**（辅助信号；纯机械重命名/格式化/注释不算）；
4. 改变**默认启用面**：`builtin-mapping`、recommended/security 预设、规则 retired/supersedes；
5. 需求含糊、存在多种实现解读，或涉及跨文件数据流/框架语义的新方案。

## 三、闸门流程

1. 生成 change-id：`YYYYMMDD-<kebab-topic>`（如 `20261029-cache-key-path`）。
2. 从 `docs/templates/change/` 复制并填写：
   - `docs/changes/<change-id>/proposal.md`（为什么做、影响面、验收）
   - `docs/changes/<change-id>/design.md`（怎么做、文件清单、测试计划、风险）
   - `docs/changes/<change-id>/tasks.md`（按依赖拆任务，每项带验收点）
3. **产出后立即停止**，向用户呈现方案，等待明确「确认通过」；优先使用平台的 Plan 模式/方案确认机制。
4. 确认后按 `tasks.md` 实现；每项过验收点，最后走 `verification.md` 自检。

## 四、禁令

- 未确认前禁止改任何代码面文件，包括「先做个最小实现」「先改这一处」；
- 等待确认期间禁止顺手改其它文件；
- 不得用「测试先写」绕过方案确认（测试文件属于代码面）。

## 五、豁免

- 预计 **1~2 个代码文件**、无行为/契约变化、需求明确无歧义；
- 纯文档、注释、格式化、构建脚本调整（不改变规则/引擎行为）；
- **纯机械重命名/格式化/注释**，即使改动 3+ 文件；
- 用户明确表示「不用出方案，直接改」——仍需在回复中记录该豁免。

## 六、特殊硬约束

- **规则文案/ messageId 变更 = breaking**：指纹参与计算，必须显式评审；
- **fixtures 是规则契约**：改实现不改用例 = 没改对；放宽断言必须在变更文档说明；
- **语料基线变更**：`corpus:check --save` 只能在逐条归因评审后执行；
- **引擎协议/诊断 schema 变更**：先更新 `docs/upgrade/v0.1/upgrade-plan.md` 的契约章节，再实现；
- **机器校验**：已提供 `scripts/check-change-id.ts` 与 `.githooks/commit-msg`；启用一次 `git config core.hooksPath .githooks` 即生效（首次提交用 `git add --chmod=+x .githooks/commit-msg` 确保可执行）。CI 也可直接调用；未启用时仍按本规则约定执行。

## 七、衔接

- 意图路由见 `workflow-guide.md`；
- 规则变更见 `../workflows/rule-change.md`；
- 完工自检见 `verification.md`；
- 决策沉淀见 `memory.md`。
