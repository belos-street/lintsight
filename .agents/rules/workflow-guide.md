---
name: workflow-guide
description: 意图到工作流的决策表，路由到 feature-development、rule-change、bug-fix、hotfix 或 refactor
alwaysApply: true
---

# 工作流决策表（Workflow Guide）

根据用户请求的**意图类型**路由到对应工作流；命中后先读 `.agents/workflows/<workflow>.md` 再动手。

## 一、意图 → 工作流

| 用户意图 / 场景 | 工作流 | 关键闸门 |
| --- | --- | --- |
| 新功能 / 新引擎能力 / 新框架 profile / 新 formatter | [feature-development](../workflows/feature-development.md) | 复杂需求先出三层文档等确认 |
| 新增 / 修改 / 删除规则（JS 或 Rust） | [rule-change](../workflows/rule-change.md) | 用例先行 + meta 完备 + 语料门禁 + 注册表登记 |
| 报障 / 误报 / 漏报 / 行为不符 | [bug-fix](../workflows/bug-fix.md) | 先复现再修复；最小改动 |
| 线上/阻断性故障 | [hotfix](../workflows/hotfix.md) | 最小止血；事后补记录 |
| 重构 / 目录迁移 / 架构调整 / 技术债 | [refactor](../workflows/refactor.md) | 必走三层文档；行为不变 |
| 评审引擎 / SAST 项目尽调 | `.agents/skills/sast-review` | 独立评分 + 证据口径 |
| 纯文档 / 计划整理 | 直接执行 | 不触发 spec-first，但要过 verification |

## 二、判定规则

1. **无法确定意图** → 先用 `grill-me` 或直接澄清，再路由；
2. **混合意图**（如「重构顺便加规则」）→ 按最重的工作流执行，并在变更文档中拆成「重构项」与「功能项」；
3. **简单改动**（1~2 文件、无行为变化、需求明确）→ 豁免 spec-first，但 verification 不豁免；
4. **与既有规则冲突** → 以 `spec-first.md` 的禁令为准。

## 三、公共红线（只引用，不重复）

- 规范先行：`spec-first.md`
- 完工验证：`verification.md`
- 提交/分支：`git-commit-message.md`
- 长期决策：`memory.md`

本文件只负责“选哪条工作流”，不承担闸门细节。
