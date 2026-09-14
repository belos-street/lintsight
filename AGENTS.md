# AGENTS.md — lintsight 仓库协作指南

> 面向在本仓库工作的 AI Agent 与新成员。项目名 **lintsight**（2026-09-14 定名，旧名 sast-engine 已废弃）。

## 1. 项目是什么

**lintsight** 是面向企业级大规模 JS/TS 代码库的静态分析引擎：以 oxlint 为语法级规则基座，自建 Rust 深度分析引擎补齐数据流/taint 能力，作为公司 SAST 平台（cleancode）的扫描内核。

**当前阶段：M0 准备期**——仓库只有设计与需求文档，尚无代码。动手写代码前先读文档地图。

## 2. 文档地图（先读再动）

| 文档 | 内容 | 什么时候读 |
| --- | --- | --- |
| [docs/requirements/requirements-v0.2.md](docs/requirements/requirements-v0.2.md)（v0.2） | 技术选型、架构、IR 分层、双报消解（§3.6）、平台契约（附录 C）、坑清单 | 做任何架构相关决策前 |
| [docs/requirements/requirements-v0.1.md](docs/requirements/requirements-v0.1.md) | FR/NFR 需求基线、决策记录 DR-1~7、里程碑验收、P0 规则候选池（附录 A） | 排期、验收、写规则前 |
| [docs/todo/todo-v0.1.md](docs/todo/todo-v0.1.md) | 分层滚动任务清单：M0 执行级（T0.x 带 DoD）、M1 任务域（spike gate）、M2/M3 占位 | 认领任务、汇报进度、滚动细化前 |
| [.agents/memory/](.agents/memory/) | 项目决策记忆：DR-1~7 全量沉淀（decisions.md，含上下文/否决项/后果）+ 评审教训（lessons.md） | 质疑选型前、做架构权衡、写文档/评审前 |

## 3. 技术路线铁律（不得偏离，变更需重新评审）

1. **双引擎**：M1 = oxlint 基座 + Bun 薄封装（不自建 JS 内核）；M2 = Rust 深度分析引擎（oxc crates 直连，sidecar 形态）与 oxlint 并行、诊断合并，**不重建 oxlint 规则宿主**。
2. **规则双轨**：语法级规则走 JS 轨道（ESLint 兼容 API，oxlint JS Plugins）；深度规则走 Rust 轨道（引擎 IR API）。规则代码禁止直接依赖任何具体 parser 的 AST 类型。
3. **类型感知**：tsgolint 首选（要求 TS 7，不支持 `baseUrl`），tsc Program 兜底；存量项目 typeRequirement 自动降级 `local`。type-aware 规则**直接启用 oxlint --type-aware（tsgolint）规则集，深度引擎不自实现**。
4. **Vue**：自建 VueProcessor（script M1 / template M2），不依赖 vize bridge 作主方案。
5. **契约先行**：诊断指纹、confidence/severity 解耦、平台路径跟踪契约（requirements-v0.2.md 附录 C，带 contractVersion）先于 taint 引擎冻结。
6. **M0 四项 spike 未出结论前，不得启动对应模块的正式实现**（oxc crate PoC / Vue×JSPlugins PoC / tsgolint 实测 / oxlint 诊断字段完备性）。
7. **双报消解**：◆ 规则升级 taint 后 JS 轨道版本默认退役，遵循 §3.6 归属矩阵（FR-407，语料库断言双报率为 0）。
8. **运行时（DR-7）**：封装层绑死 Bun——bun install/workspaces + bun.lock 提交、Bun 专有 API（Bun.file/Bun.Glob 等）放开用、`bun build --compile` 单文件二进制分发、bun test 承载测试；不追求 Node 兼容（前提：T0.13 验证通过）。

## 4. 工程约定（写代码后生效）

- **结构**：Bun monorepo（bun install/workspaces + bun.lock 提交，packages/@lintsight/*）+ `rust/deep-engine` crate workspace（DR-7；见 requirements-v0.2.md §2.5）。
- **命名**：文件/目录 kebab-case；函数/变量 camelCase；类型 PascalCase；常量 UPPER_SNAKE_CASE。
- **风格**：单引号、无分号、2 空格、80 列；lint 用 oxlint、format 用 oxfmt。TS 开启 strict 全家桶。
- **错误处理**：永不静默吞错；typed error；fail-fast；单文件解析失败降级为诊断而非中断（NFR-2）。
- **Git**：
  - commit 格式 `<type>: <subject>`（type ∈ feat/docs/fix/refactor/chore/perf/test，小写 + 祈使句），原子提交，半成品标 `WIP`；
  - 分支：`main`（稳定）+ `dev`（日常）+ `feature/*`；共享分支不 force push；
  - `.env` / 密钥永不提交；误提交密钥立即轮换。
- **性能门禁**：基准回退 >15% 拦截合并；规则结果变更必须附语料库 diff 与误报分析（FR-702/703）。

## 5. 文档与需求变更纪律

- 需求以 `FR-`/`NFR-` 编号管理：新增/修改需求必须升文档版本号并写修订记录。
- 引用需求时用编号（如 FR-302），不要凭记忆复述指标。
- spike / 评审结论必须落档（写入对应文档或 `docs/` 新增文件），不留只在对话里的决策；决策的**上下文与理由**同步沉淀到 `.agents/memory/decisions.md`，教训沉淀到 `lessons.md`。
- 跨文档术语一致：fingerprint（指纹）、confidence、typeRequirement、sidecar 双引擎等以 requirements-v0.2.md / requirements-v0.1.md 术语表定义为准。

## 6. 本地 skills 路由（.agents/skills/）

| 任务 | 读哪个 |
| --- | --- |
| 消费 oxc crates、调 oxlint 配置/CLI、JS Plugins、升级 oxc 依赖 | `oxc-toolchain` |
| 写/改/评审 lint 规则、处理误报 | `rule-authoring` |
| 写/改 Rust 代码（M2 深度引擎） | `rust-best-practices` |
| 通用工作流（计划/TDD/调试/审查/收尾） | `superpowers` |
| 需求模糊需要澄清 | `grill-me` |
| 写码/review/写文档的规范总纲 | `belos-street`（写文档前必读其 doc-writing-guidelines） |

> 待补 skill：`taint-engine`（source/sanitizer/sink 建模与附录 C 契约，M1 末编写，避免过早固化）。
