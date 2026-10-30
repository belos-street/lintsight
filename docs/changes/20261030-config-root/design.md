# Design: G13 配置根与路径契约

> change-id：`20261030-config-root` · 日期：`2026-10-30`

## 技术设计

### 1. 根解析契约

```ts
// CLI
const rootArg = readOption('--root')
const cwd = process.cwd()
const root = path.resolve(cwd, rootArg ?? '.')
```

优先级（按可观测行为表述）：

1. **`--root`**：显式项目根；所有相对路径以它为基准。
2. **`--config`**：显式配置文件；相对 **root** 解析（未给 root 时即 cwd）。它不改变根，只覆盖配置文件发现。
3. **cwd**：默认根；`root/lintsight.config.json` 自动发现。

> 等价写法：`--root <dir> --config <file>` = 在 `<dir>` 下用 `<file>`；只给 `--config` = 在 cwd 下用该文件；都不给 = cwd + 自动发现。这样 scanner 不 chdir 也能显式控制。

`pipeline` 入参增加 `root?: string`，内部以 `const root = path.resolve(opts.root ?? cwd)` 使用；`cwd` 仅保留给进程 spawn 的 working directory（与 root 相同）。

### 2. root 贯通点（逐项替换）

| 环节 | 现状 | G13 |
| --- | --- | --- |
| 配置发现 | `resolveConfigFile(cwd, config)` | `resolveConfigFile(root, config)` |
| 生成 oxlintrc | `generateOxlintrc(cwd, ...)` | `generateOxlintrc(root, ...)` |
| 缓存目录 | `<cwd>/.lintsight-cache` | `<root>/.lintsight-cache` |
| 输入解析 | `path.resolve(cwd, input)` | `path.resolve(root, input)`；绝对输入原样 |
| ignore 匹配 | 相对 cwd | 相对 root（扫描根相对 + root 相对两候选，保持现有语义） |
| tsconfig 发现/别名 | `discoverTsconfigs(cwd, inputs)` | root |
| Vue 虚拟化/gitignore | `virtualizeVue(f, cwd)` / `ensureGitignore(cwd)` | root |
| 诊断归一 | `normalizeDiagnostics(output, cwd)` | root |
| 抑制文件读取 | `path.resolve(cwd, file)` | root |
| 引擎 spawn | `runEngine(..., { cwd })` | `{ cwd: root }`（协议 file 相对 root） |
| 报告 file | root 相对 | 不变，但 root 可外部指定 |
| 缓存指纹 tsconfig 相对路径 | 相对 cwd | 相对 root |

- `collectFiles` 的 `ignored()` 改为 root 相对；扫描根相对路径语义保留（`src/gen/**` 仍相对输入目录）。
- 根外输入：`normalizeFilePath` 现有行为返回原路径（可能是绝对/`..`）；G13 记录 warning，不静默篡改。
- `CACHE_DIR_NAME` 位置随 root；写入前 `mkdir` 不变。

### 3. CLI

```text
usage: ... [--root <dir>] ...
```

- `--root` 取值缺失 → exit 2（与 `--fail-on` 缺值同纪律）。
- `--root` 指向不存在目录 → pipeline 在收集阶段报 `input path not found` / 明确错误 → exit 2。
- `--root` 与 `--config` 同时存在：config 按 root 解析。
- 传 `--root` 时，报告 `toolVersion`/`engineStatus` 等字段不变，仅路径基准变化。

### 4. 外部绝对路径验收

测试项目放在系统 tmpdir：

```text
<tmp>/project/
  lintsight.config.json
  src/a.ts（坏代码）
```

调用 `runPipeline(['.'], { root: projectDir, cwd: process.cwd() })`：

- 读取 `<projectDir>/lintsight.config.json`；
- 诊断 `file === 'src/a.ts'`，不含盘符/`/Users/`；
- 缓存写入 `<projectDir>/.lintsight-cache`，不污染仓库。

### 5. 与缓存 / G6 的交互

- 缓存键的 `path@storeRel` 仍为 root 相对；root 改变 → 路径变化 → 新键（预期一次性 miss）。
- `engineStatus` 与 root 无关；引擎协议 `file` 以 `--root` 相对，pipeline `unitMap` 口径不变。
- 不改变 G1 的「引擎结果不缓存」策略。

## 涉及文件清单

- 改动：`packages/lintsight-cli/src/cli.ts`
- 改动：`packages/lintsight-cli/src/pipeline.ts`
- 改动：`packages/lintsight-config-bridge/src/index.ts`（如需显式 root 参数）
- 新增（测试）：`packages/lintsight-cli/test/config-root.test.ts`
- 改动（测试）：`packages/lintsight-cli/test/ignore.test.ts`、`closed-loop.test.ts`（如断言路径基准）
- 文档：`docs/upgrade/v0.1/execution-todo.md`、`upgrade-plan.md`、本 change
- Rust：无改动

## 测试计划

| 用例 | 断言 |
| --- | --- |
| 外部绝对路径 + `--root` | config 来自目标；报告 file 为 `src/a.ts`；缓存落目标 |
| 嵌套 config（`--config sub/...` 相对 root） | 生成配置使用该文件；规则生效 |
| 显式 `--config` 覆盖 root 默认 | 默认 config 不被读取 |
| `--root` 缺值/不存在 | exit 2，stderr 可操作 |
| ignore 回归 | 目录 glob / 外部目标 / 非法模式不变 |
| Vue 回归 | `.vue` 虚拟化仍就地、诊断回映射相对 root |
| 冷/热回归 | 同 root 下缓存命中行为不变 |

命令：`bun test packages/lintsight-cli/test/{config-root,ignore,closed-loop}.test.ts`；`bun run test`；`lint` / `format:check`；`corpus:check`（不改检测面）。

## 风险与已知坑

1. **语义变更面大**：cwd → root 是机械替换，但任何一个漏改都会导致配置/缓存/报告混用两个根。任务按「先加 root 贯通 + 测试，再改 CLI」拆分。
2. **根外输入**：保持现有 normalize 行为（可能绝对路径），只告警；不把根外文件伪装成 root 相对。
3. **oxlint 自动发现**：无 root 配置文件时 oxlint 仍可能向上发现祖先 `.oxlintrc.json`；G13 只定义 lintsight 配置根，不改变 oxlint 自身发现。
4. **scanner 契约**：`--root` 的传参方式需 scanner 联调确认；G13 只保证引擎侧语义，签字可后补（与 G2 同纪律）。
5. **Windows 盘符**：`path.resolve(root, absInput)` 对绝对输入原样；测试用 tmpdir 覆盖 Windows 路径。
