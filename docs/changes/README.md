# 变更记录（Changes）

> 当次变更层的唯一存放处：复杂需求在动手前先在这里产出三层文档，确认后再实现。
> 规则见 `.agents/rules/spec-first.md`；工作流见 `.agents/workflows/`。

## 何时创建

触发条件以 `.agents/rules/spec-first.md` 为准；本文件只定义目录、命名与状态。

简单判断：行为/契约变化或跨模块 → 建；1~2 文件且无行为变化 → 不建；纯机械重命名/格式化豁免。

## 目录与命名

```text
docs/changes/<YYYYMMDD-kebab-topic>/
├── proposal.md   # 为什么做、影响面、验收
├── design.md     # 怎么做、文件清单、测试计划、风险
└── tasks.md      # 按依赖拆任务，每项带验收点
```

示例：`docs/changes/20261029-cache-key-path/`。

提交时在提交正文带 change-id：`change/20261029-cache-key-path`（规则见 `.agents/rules/git-commit-message.md`）。

## 状态

在 `proposal.md` 头部标注：

- `草稿`：方案编写中；
- `已确认`：用户/评审确认，可以进入实现；
- `已实现`：代码与验证完成；
- `已放弃`：保留原因，不删除记录。

## 与升级计划的关系

- 范围/验收的长期决策 → `docs/upgrade/v0.1/upgrade-plan.md`；
- 执行状态 → `docs/upgrade/v0.1/execution-todo.md`；
- 本次变更的影响面与实现细节 → 本目录 `docs/changes/<id>/`。

变更若改变计划范围/优先级，先改 `upgrade-plan.md`，再同步 `execution-todo.md`。

## 模板

- [proposal](../templates/change/proposal.md)
- [design](../templates/change/design.md)
- [tasks](../templates/change/tasks.md)

## 归档

变更记录随代码提交保留，不删除；后续同类变更可引用旧 change-id。
