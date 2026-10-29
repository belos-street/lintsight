---
name: project_rules
description: 项目代码规范总纲，声明 AI 生成代码必须遵循的规范来源
alwaysApply: false
---

# 项目代码规则总纲

AI 生成/修改的代码必须遵循以下规范来源：

1. **JS/TS 基础规范**：`.agents/skills/belos-street/skill.md`（命名、组织、错误处理、测试、提交、文档）。
2. **Rust 规范**：`.agents/skills/rust-best-practices/SKILL.md`（所有权、错误处理、并发、数据建模）。
3. **规则开发规范**：`.agents/skills/rule-authoring/SKILL.md`（用例先行、meta 完备、语料门禁、注册表）。
4. **oxc/oxlint 规范**：`.agents/skills/oxc-toolchain/SKILL.md`（版本锁定、配置、JS Plugins、type-aware）。
5. **评审规范**：`.agents/skills/sast-review/SKILL.md`（独立评分、证据口径、框架扩展性）。

## 一致性约束

- `AGENTS.md` 中声明的每个技能，必须在 `.agents/skills/` 下存在对应文件；
- 规则代码不得直接依赖具体 parser 的 AST 类型（铁律 2）；JS 轨道走 ESLint API，Rust 轨道走 `FileContext`/IR 面。**目标态：G4 未完成，当前 `rules.rs` 仍直接依赖 `oxc_ast`；评审/写码时标注现状，不把目标态当事实。**
- 运行时绑死 Bun；oxlint/oxc 版本精确锁定，升级走 `oxc-toolchain` 门禁；
- 本仓只做 JS/TS 引擎；平台职责见 `.agents/memory/README.md`，不得塞进引擎。
