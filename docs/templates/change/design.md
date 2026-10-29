# Design: <变更主题>

> change-id：`<YYYYMMDD-kebab-topic>` · 日期：`<YYYY-MM-DD>`

## 技术设计

<架构/数据流/接口签名/关键实现点；taint 变更画 source→propagator→sanitizer→sink。>

## 涉及文件清单

- 改动：`<路径>`
- 新增：`<路径>`
- 删除：`<路径>`

## 规则 / 引擎影响

- 规则 ID、category、severity、confidence、CWE/OWASP：
- 检测层：`none` / `local` / `taint`
- source/sink/sanitizer/propagator 表变化：
- 注册表 / builtin-mapping / 预设变化：
- 指纹 / message / golden / SARIF 影响：

## 测试计划

- 用例：bad / good / safe / 边界
- 命令：`bun run test` / `cargo test --release` / `corpus:check` / `bench`
- 冷/热扫、TSX/Vue、外部路径等专项：

## 风险与已知坑

<引用 `.agents/memory/decisions.md`、`docs/spikes/` 已知边界、历史误报；未确认前不实现。>
