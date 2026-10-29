# Proposal: <变更主题>

> change-id：`<YYYYMMDD-kebab-topic>` · 日期：`<YYYY-MM-DD>` · 状态：草稿 / 已确认 / 已实现 / 已放弃

## 背景与问题

<为什么做？现状痛点、触发场景、关联 FR/CWE/升级计划条目。>

## 目标与非目标

- 目标：
  - <…>
- 非目标（明确不做，防止范围蔓延）：
  - <…>

## 方案选型

<多方案列权衡（成本/风险/维护）并给推荐；单方案说明为何选它。>

## 影响面清单

- 代码面：
  - `packages/…`
  - `crates/…`
  - `plugins/…`
  - `fixtures/…`
  - `scripts/…`
- 契约面：ruleId / message / fingerprint / severity / confidence / 诊断 schema / 引擎协议 / 缓存键 / scanner 契约
- 文档面：`docs/upgrade/…`、`docs/spikes/…`、`AGENTS.md`、`.agents/…`
- 测试面：RuleTester / cargo test / golden / SARIF / corpus

## Breaking Changes

<是否有规则文案、指纹、ruleId、默认启用、协议字段变化？没有写“无”。>

## 验收标准

<可验证的通过条件：测试名、命令、指标阈值、报告路径。>
