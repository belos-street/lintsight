---
name: git-commit-message
description: 提交信息规范，Conventional Commits + 中文描述 + 复杂变更 change-id
alwaysApply: false
scene: git_message
---

# 提交信息规范

1. 遵循 Conventional Commits：`type(scope): 中文摘要`。
2. 常用 type：`feat` / `fix` / `docs` / `test` / `refactor` / `chore` / `perf` / `build` / `ci`。
3. 除必要术语外使用中文描述；标题不超过 72 字符。
4. 复杂变更（改动 **3+ 个代码文件**或触发 spec-first）的提交正文必须带 change-id：`change/<YYYYMMDD-主题>`。
5. 破坏性变更使用 `!` 或在正文写 `BREAKING CHANGE:`；规则 message/messageId/指纹变更必须显式标注。
6. 提交按原子单元拆分；不把文档、代码、生成产物混在一个无法解释的提交里。
7. 不直接推送 `main`；按项目分支约定推 dev 分支，PR 走评审。
8. 不得使用 `--no-verify` 绕过校验，除非用户明确知情并要求。
