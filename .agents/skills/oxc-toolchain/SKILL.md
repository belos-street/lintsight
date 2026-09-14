---
name: "oxc-toolchain"
description: "oxc/oxlint 工具链知识：oxc crates（parser/semantic/cfg）API、oxlint 配置与 CLI、JS Plugins、type-aware（tsgolint）、版本锁定策略。写 oxc 相关代码、调 oxlint 配置、开发 spike、升级依赖前必读。"
---

# oxc-toolchain

lintsight 的地基是 oxc/oxlint 工具链。本 skill 沉淀工具链的关键事实、已知坑与升级纪律，避免每次从官方文档重新考古。

## 使用场景 → 读哪篇

| 你在做什么 | 先读 |
|-----------|------|
| 写 Rust 代码消费 oxc crates（M2 深度分析引擎、spike ①） | [oxc-crates](reference/oxc-crates.md) |
| 写 .oxlintrc 配置、CLI 调用、诊断桥接（config-bridge/diagnostic-bridge） | [oxlint-config-and-plugins](reference/oxlint-config-and-plugins.md) |
| 写 JS Plugin 规则、评估 JS Plugins 能力边界（spike ②） | [oxlint-config-and-plugins](reference/oxlint-config-and-plugins.md) |
| type-aware / tsgolint 集成（spike ③、FR-305） | [oxlint-config-and-plugins](reference/oxlint-config-and-plugins.md) |
| 升级 oxlint/oxc 版本、处理上游 breaking change | [version-policy](reference/version-policy.md) |
| ESLint → oxlint 配置迁移（FR-502 迁移工具） | 直接安装官方 skill：`npx skills add https://github.com/oxc-project/oxc --skill migrate-oxlint`（来源：npm oxlint README，2026-09 核实） |

## 核心事实速记（2026-09 核实，随升级更新）

| 事实 | 数值/状态 | 对 lintsight 的意义 |
| --- | --- | --- |
| oxlint 内置规则 | **865+**（oxc.rs 核实） | M1 规则面基线；自有规则聚焦空缺（FR-202） |
| JS Plugins | **alpha**，兼容 ESLint v9 插件 API，跑在 oxlint 嵌入式 JS runtime | M1 自有规则宿主；alpha 风险见升级纪律 |
| type-aware | tsgolint stable v7（2026-07-22），覆盖 typescript-eslint **59/61** 条 type-aware 规则 | FR-305 直接启用 `oxlint --type-aware`，不自实现 |
| tsgolint 依赖 | TypeScript **7.0+**；**不支持 `baseUrl`** 等遗留配置 | 存量项目降级策略（DR-4） |
| 多文件分析 | 一等公民：project-wide module graph，跨规则共享解析 | 架构规则/跨文件规则白捡 |
| 性能 | 官方基准 50~100x ESLint；type-aware 12~18x ESLint+typescript-eslint | NFR-1 性能预算的上游依据 |
| 输出格式 | default/json/agent/sarif/gitlab/checkstyle/junit/github/unix | diagnostic-bridge 消费 `json`；FR-402 SARIF 直接可用 |

## 与仓库铁律的联动（违反即停）

1. M1 不自建 Node 内核——解析/调度/并行全部复用 oxlint（AGENTS.md 铁律 1）。
2. 规则代码禁止直接依赖具体 parser 的 AST 类型：JS 轨道走 ESLint 兼容 API，Rust 轨道走引擎 IR API（铁律 2）。
3. type-aware 规则直接启用 oxlint --type-aware，深度引擎不自实现（铁律 3）。
4. 升级 oxlint/oxc 版本必须走 [version-policy](reference/version-policy.md) 的门禁流程。
