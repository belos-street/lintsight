# Design: G14 单一版本源

> change-id：`20261030-version-source` · 日期：`2026-10-30`

## 技术设计

### 1. 唯一源与运行时读取

- 唯一源：仓库根 `package.json` 的 `version`（`0.1.0-alpha.0`）。
- CLI 运行时直接读取根版本：

```ts
import rootPkg from '../../../package.json'
const TOOL_VERSION = rootPkg.version
```

  - `--version`、`pipeline.toolVersion`、SARIF `toolVersion` 全部使用 `TOOL_VERSION`；
  - `bun build --compile` 会把 JSON 内联进单文件产物，无运行时文件依赖。

- CLI 包自身 `package.json` 版本仍需与根一致（npm 包面/工作区展示）；它不是运行时来源，由 `version:check` 守护。
- Cargo `version` 同为根版本；Rust 侧 `CARGO_PKG_VERSION` 与 CLI 版本一致（`version:check` 校验 manifest；summary 版本字段保持 Cargo 来源）。

### 2. `version:check` 脚本

```text
bun run version:check
```

校验：

1. 根 `package.json.version`；
2. `packages/lintsight-cli/package.json.version`；
3. `crates/lintsight-engine/Cargo.toml` 的 `[package] version`（正则解析，单 crate 足够）；
4. 可选：读 `packages/lintsight-cli/src/cli.ts` 引用的根版本（运行时单测覆盖）。

全部相等 → exit 0 并打印；任一不等 → exit 1 并列出差异与修复顺序：

```text
版本漂移：
  root       0.1.0-alpha.0
  cli        0.0.1
  engine     0.1.0
修复：bump 根 version，然后同步 CLI package 与 Cargo.toml，再跑 bun run version:check
```

- 脚本零依赖，纯文本/JSON 读取；不修改文件（check-only，避免隐式写入）。
- CI（G3）在 static 阶段执行。

### 3. 版本变动的缓存影响

- `cache.ts` 的 engine 指纹含 `lintsight@<CLI 包版本>`；切换到根版本后指纹变化 → 旧条目一次性 miss（fail-open）。
- 该变化只影响一次扫描成本，不改变诊断与指纹。

### 4. 发布检查清单（写入文档，G11 自动化）

1. bump 根 `package.json.version`；
2. 同步 `packages/lintsight-cli/package.json` 与 `crates/lintsight-engine/Cargo.toml`；
3. `bun run version:check`；
4. `bun run test`；
5. 重新生成 golden（仅 `toolVersion` 变化）；
6. cargo build --release 后确认 engine summary 版本；
7. 打 tag / 发布（G11 接管）。

### 5. 测试

- `version-consistency.test.ts`：
  - 读三个载体断言相等；
  - `formatSarif` 用根版本 → `driver.version`/`semanticVersion` 一致；
- CLI 集成：spawn `--version` 断言 `lintsight v<root>`；
- golden：`report-v3.json` 的 `toolVersion` 更新为根版本；
- `git diff` 仅这些位置变化。

## 涉及文件清单

- 新增：`scripts/version-check.ts`
- 改动：`package.json`（新增 `version:check` script）
- 改动：`packages/lintsight-cli/package.json`（版本对齐）
- 改动：`crates/lintsight-engine/Cargo.toml`（版本对齐）
- 改动：`packages/lintsight-cli/src/cli.ts`（读根版本）
- 改动：`packages/lintsight-cli/src/pipeline.ts`（toolVersion 读根版本）
- 改动（测试）：新增 `packages/lintsight-cli/test/version-consistency.test.ts`、CLI `--version` 用例
- 改动（golden）：`packages/lintsight-cli/test/__golden__/report-v3.json`
- 文档：`docs/upgrade/v0.1/execution-todo.md`、`upgrade-plan.md`、本 change
- Rust：仅 Cargo.toml 版本字段

## 测试计划

| 用例 | 断言 |
| --- | --- |
| `version:check` | 三载体相等 exit 0；人为改一处 exit 1（测试用临时副本或单元函数） |
| `--version` | `lintsight v<root.version>` |
| SARIF | `driver.version` = `semanticVersion` = 根版本 |
| JSON golden | `toolVersion` = 根版本，其余字段不变 |
| 缓存 | engine 指纹随版本变化；冷/热行为不变 |

命令：`bun run version:check`；`bun test packages/lintsight-cli/test/version-consistency.test.ts`；`bun run test`；`lint` / `format:check`；`cargo test --release`。

## 风险与已知坑

1. **JSON import 在 compile 产物**：Bun 支持 JSON 内联；若升级 Bun 后行为变化，CI 的 `build:binary` 需回归。
2. **三处手动同步**：check-only 意味着 bump 时要改三处；G11 changesets 接管后消除。CI 红即阻断，避免漂移进入 main。
3. **预发布 semver**：`0.1.0-alpha.0` 的排序/展示由 npm/semver 处理；脚本只做字符串相等，不做 semver 解析。
4. **缓存一次性 miss**：版本切换后首轮冷扫，属预期；不因此修改缓存键设计。
5. **SARIF 消费方**：driver.version 变化可能影响平台按版本过滤；G14 只统一源，不改变格式。
