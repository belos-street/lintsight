# Proposal: G14 单一版本源（CLI / 根包 / 引擎 / SARIF）

> change-id：`20261030-version-source` · 日期：`2026-10-30` · 状态：已实现

## 确认记录

- 2026-10-30：方案评审补强后，用户以消息全文 **「好的，按这个方案开始实现 G13、G14 和 G3」** 确认进入实现（无独立消息 ID，仓库内只能引用原话）；确认范围 = G13/G14/G3 三份 change 的三层文档全量方案。

## 背景与问题

当前版本号四处不一致：

- 根 `package.json`：`0.1.0-alpha.0`
- CLI `packages/lintsight-cli/package.json`：`0.0.1`
- 引擎 `crates/lintsight-engine/Cargo.toml`：`0.1.0`
- SARIF `driver.version` / `--version`：来自 CLI 包（`0.0.1`）

发布、缓存对账（G1 engine 指纹含 lintsightVersion）、平台版本识别都会因此漂移；评审 M1 与本执行清单 G14 要求单一版本源与 CI 检查。

## 目标与非目标

- 目标：
  - **根 `package.json` 为唯一版本源**（当前 `0.1.0-alpha.0`）。
  - CLI 包、Cargo 包版本与根一致；`--version`、JSON 报告 `toolVersion`、SARIF `driver.version` 均取同一值。
  - 新增 `bun run version:check`（本地 + CI 门禁），校验四个载体一致。
  - 发布检查清单写入文档；G11 changesets 后续接管自动 bump。
- 非目标：
  - 不做 changesets/多平台产物/签名/SBOM（G11，M6）。
  - 不做运行时版本协商/能力协商（G17，M6）。
  - 不改引擎规则/诊断行为。

## 方案选型

| 方案 | 做法 | 取舍 | 结论 |
| --- | --- | --- | --- |
| A. 以 CLI 包为源 | 根与 Cargo 跟随 CLI | CLI 是私有包，平台更常引用仓库/引擎版本 | 否决 |
| B. 根 package.json 为源（推荐） | CLI 运行时直接读根版本；CLI 包与 Cargo 同步；脚本校验 | 单点可审计；Cargo 只能手动/脚本同步 | **采纳** |
| C. 独立 `VERSION` 文件 | 三方读取 VERSION | 多一个非标准载体，工具链支持弱 | 否决 |
| D. Cargo workspace 继承版本 | `version.workspace = true` | 需新增 workspace 根，影响 crate 布局 | 暂不采用（可在 G11 评估） |

## 影响面清单

- 代码面：
  - `packages/lintsight-cli/src/cli.ts`（`--version` 改用根版本）
  - `packages/lintsight-cli/src/pipeline.ts`（`toolVersion` 改用根版本）
  - `packages/lintsight-cli/package.json`、`crates/lintsight-engine/Cargo.toml`（版本对齐）
  - 新增 `scripts/version-check.ts` + `package.json` script
- 契约面：`--version` 输出、JSON `toolVersion`、SARIF `driver.version`、缓存 engine 指纹（lintsightVersion 变化 → 一次性 miss）
- 测试面：版本一致性测试、CLI `--version`、SARIF 快照、golden `toolVersion`
- 文档面：本 change、`execution-todo.md` G14、`upgrade-plan.md` 发布口径
- Rust：仅 Cargo.toml 版本字段；无代码改动

## Breaking Changes

- `--version` / SARIF / JSON `toolVersion` 从 `0.0.1` 变为 `0.1.0-alpha.0`（统一到根版本）。
- 缓存 engine 指纹中的 `lintsight@<版本>` 变化 → 一次性全量 miss（fail-open，无用户可见错误）。
- 无规则文案/指纹/schema 变化。

## 验收标准

- `bun run version:check` 通过，输出四个载体版本。
- `bun run cli -- --version` 输出 `lintsight v0.1.0-alpha.0`。
- SARIF `driver.version` / `semanticVersion` 与根版本一致；JSON `toolVersion` 一致。
- 版本一致性测试在 `bun run test` 中固化；golden 更新仅 `toolVersion`。
- 发布检查清单写入文档（bump 顺序：根 → CLI/Cargo → 跑 check）。
