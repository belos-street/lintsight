# Design: G12 默认 recommended/security 预设

> change-id：`20261102-default-preset` · 日期：`2026-11-02`

## 技术设计

### 1. 现状与规则账（2026-11-02 核对）

27 条自有 JS 规则（registry `status:'active'`）：

| # | ruleId | category | defaultSeverity | confidence |
| --- | --- | --- | --- | --- |
| 1 | `lintsight/no-empty-catch` | correctness | error | high |
| 2 | `lintsight/no-async-array-method` | correctness | error | high |
| 3 | `lintsight/no-floating-promise` | correctness | error | medium |
| 4 | `lintsight/no-swallowed-promise-error` | correctness | error | medium |
| 5 | `lintsight/no-closure-loop-var` | correctness | error | high |
| 6 | `lintsight/no-array-map-side-effect` | correctness | warning | medium |
| 7 | `lintsight/no-json-structured-clone` | correctness | warning | high |
| 8 | `lintsight/no-ignored-reduce-result` | correctness | error | high |
| 9 | `lintsight/no-empty-promise-catch` | correctness | error | medium |
| 10 | `lintsight/no-async-constructor-call` | correctness | warning | medium |
| 11 | `lintsight/no-sync-io-in-async` | correctness | warning | high |
| 12 | `lintsight/no-hardcoded-credentials` | security | error | medium |
| 13 | `lintsight/no-unsafe-regex` | security | warning | high |
| 14 | `lintsight/no-prototype-pollution-syntax` | security | error | high |
| 15 | `lintsight/no-child-process-nonliteral` | security | error | medium |
| 16 | `lintsight/no-non-literal-fs-filename` | security | warning | **low** |
| 17 | `lintsight/no-non-literal-require` | security | error | high |
| 18 | `lintsight/no-weak-hash` | security | warning | high |
| 19 | `lintsight/no-math-random-secret` | security | error | medium |
| 20 | `lintsight/no-sensitive-storage` | security | error | medium |
| 21 | `lintsight/no-innerhtml-assignment` | security | error | medium |
| 22 | `lintsight/no-sql-concat` | security | error | medium |
| 23 | `lintsight/no-cors-wildcard` | security | warning | high |
| 24 | `lintsight/no-vm-dynamic-code` | security | error | medium |
| 25 | `lintsight/no-insecure-cookie` | security | warning | medium |
| 26 | `lintsight/no-unsafe-trust-bypass` | security | error | medium |
| 27 | `lintsight/no-serve-index` | security | warning | high |

引擎 9 条：6 条常驻（`no-eval` / `no-path-traversal` / `no-command-injection` / `no-ssrf` / `no-prototype-pollution-merge` / `no-open-redirect`）+ 3 条配置驱动（`arch-boundaries` / `no-import-cycle` / `no-deep-import`）。预设只影响 JS 轨道。

### 2. 配置契约

```ts
export type PresetName = 'recommended' | 'security' | 'none'

export interface LintsightConfig {
  /** G12：默认预设；缺省 recommended。none = 仅 builtinMapping + 显式 rules */
  preset?: PresetName
  // …现有字段不变
}
```

- `validateConfig`：`preset` 非上述三值 → errors，`generateOxlintrc` 抛配置无效（CLI exit 2）。
- **无配置文件行为（钉死）**：`preset` 只在存在 `lintsight.config.json` / `--config` 时生效。无 config 项目不生成默认 oxlintrc，保持现状（oxlint correctness + 引擎 6 条常驻；自有 JS 规则 0 启用）。G12 不改自动发现行为；需要 preset 的项目必须显式建 config。该边界必须有 E2E 断言（无 config 坏样本 → 无 `lintsight/*` 诊断），并写入 README/发布说明。
- `preset:"none"` = 现状（`builtinMapping.categories.correctness` 仍生效）。

### 3. 预设展开

新增 `packages/lintsight-config-bridge/src/presets.ts`：

```ts
export const PRESET_NAMES = ['recommended', 'security', 'none'] as const

/** registry 派生：active 且 owner=lintsight-js */
export function expandPreset(
  name: PresetName,
  entries: RegistryEntry[]
): Record<string, RuleSetting>
```

展开规则：

| preset | 覆盖面 | severity |
| --- | --- | --- |
| `recommended` | 27 条自有 JS + 1b 内置清单 | 自有 = registry `defaultSeverity`；1b = 固定表 |
| `security` | 同 recommended | 自有 security 16 条 → `error`；1b 安全项 → `error`；其余不变 |
| `none` | 空 | — |

合并顺序（`translate()`）：

```
builtinMapping.rules（无条件默认，当前 {}）
  → presetRules（按 preset 展开）
  → config.rules（显式覆盖，含 off→allow）
  → oxlint overrides.rules（按文件覆盖）
```

- 显式 `rules` 永远赢预设；`off` 可逐条关闭。
- **severity 映射**：registry `defaultSeverity='warning'` 在展开时转为 oxlint 的 `'warn'`（oxlint 只接受 allow/off/deny/error/warn；实测写 `warning` 会让配置文件解析失败 exit 1）。
- `overrides.rules` 不参与预设展开（现状语义不变）。
- 等价报告新增一行 `preset: <name>`（`none` 不输出），不逐条展开 27 行；`config-bridge.test.ts` 的等价报告用例同步更新。

### 4. registry 增加 category

`RegistryEntry` 增加：

```ts
export type RuleCategory =
  | 'correctness' | 'security' | 'performance'
  | 'maintainability' | 'architecture'
category: RuleCategory
```

- 27 条 JS 逐条登记（11 correctness / 16 security），与规则 `meta.category` 一致；`registry.test.ts` 增加 category 一致性校验（现有 meta 对齐测试扩展）。
- G9 新增的 2 条 JSX 规则登记为 `security`，预设自动纳入（快照由 G9 更新 27→29）。
- 引擎条目同样补 category（security/architecture），避免可选字段分叉；不参与 JS 预设。

### 5. 1b 内置清单（按 oxlint 1.83.0 实测修正）

| 内置规则 | recommended | security | 可用性（`--rules` + 探针） | 备注 |
| --- | --- | --- | --- | --- |
| `eslint/no-new-func` | error | error | ✅ 命中 | CWE-95 |
| `eslint/no-throw-literal` | error | error | ✅ 命中 | 正确性 |
| `eslint/array-callback-return` | error | error | ✅ 命中 | 正确性 |
| `eslint/no-promise-executor-return` | error | error | ✅ 规则在册 | 正确性 |
| `eslint/no-fallthrough` | error | error | ✅ 命中 | 正确性 |
| ~~`eslint/no-await-in-loop`~~ | — | — | ✅ 命中，但 corpus **+420 warning** | **不默认启用**：perf 提示非安全面，稀释安全信号；待 perf/strict 预设 |
| `eslint/no-proto` | error | **error** | ✅ 命中 | 安全语义 |
| `eslint/no-prototype-builtins` | warn | **error** | ✅ 命中 | 安全语义 |
| `promise/catch-or-return` | error | error | ✅ 规则在册 | 安全/正确性 |
| `unicorn/no-document-cookie` | warn | **error** | ✅ 命中 | 与自有 no-insecure-cookie 分工 |
| ~~`eslint/no-unsafe-finally`~~ | — | — | 已由 correctness 类别默认启用 | 不重复登记 |
| ~~`react/no-danger`~~ | — | — | `--rules` 存在（`no-danger|react`），但默认未启用；启用需 `plugins:["react"]`（覆盖默认插件集） | 不在 G12 启用；React 面归 H5，JSX sink 由 G9 自有规则覆盖 |
| ~~`react/no-danger-with-children`~~ | — | — | `--rules` 存在 | 不启用；React 面归 H5 |
| ~~`typescript/no-misused-promises`~~ | — | — | 需 `--type-aware` | 不进默认预设，随 typeAware 开启 |

- **不写 `plugins` 字段**：实测 `plugins:["react"]` 会覆盖默认插件集（unicorn/promise 等失效）；react 规则不在 G12 范围。
- 安全项定义：`no-new-func` / `no-proto` / `no-prototype-builtins` / `promise/catch-or-return` / `unicorn/no-document-cookie` 在 security 预设提升为 error；其余保持表中级别。

### 6. low confidence 与 `--fail-on`

- `pipeline.ts` 的 `failRank` 用**逐 finding confidence**；`security` 预设只改 severity，不改 confidence。
- 因此 `no-non-literal-fs-filename`（low）即使在 security 预设为 error，也不会被 `--fail-on high` 拦截；`--fail-on low` 仍会。
- 验收专测：low confidence 命中 + `failOn:'high'` → exit 0；`failOn:'low'` → exit 1。

### 7. rule-count（三口径）

新增 `scripts/rule-count.ts`（`bun run rule-count`）：

- `registered`：registry `status:'active'` 条目（JS 27 + engine 9 = 36）。
- `enabled`：生成 oxlintrc 中非 `allow` 的规则键，分 `own`（lintsight/*）与 `builtin`（1b 清单）两组。
- `effective`：**`enabled`（own + builtin）+ 引擎常驻 6**（`no-eval`/`no-path-traversal`/`no-command-injection`/`no-ssrf`/`no-prototype-pollution-merge`/`no-open-redirect`）；配置驱动的 3 条引擎规则不计入，除非 `arch.importCycles/enforceExports/zones` 实际启用。1b 已 enabled 且实际运行，不能漏计。

输出示例：

```
registered: js=27 (correctness=11 security=16) engine=9
enabled: own=27 builtin=9
effective: 27 + 9 + engine-resident 6 = 42
```

- `recommended` = 42；`security` = 42（仅 severity 变化）；`none` = 0 + 0 + 6 = 6；G9 后 = 29 + 9 + 6 = 44。
- 快照测试锁规则 ID 列表与 severity，不锁纯数字（G9 会改变 27→29、42→44）。

### 8. Dead-rule 防呆

新增测试：spawn `oxlint --rules`（用 `resolveOxlintBin`），解析表格的 `rule name | source` 两列，**按 source+name 匹配**：

- `eslint/no-new-func` → 行 `no-new-func | eslint`；
- `promise/catch-or-return` → 行 `catch-or-return | promise`；
- `unicorn/no-document-cookie` → 行 `no-document-cookie | unicorn`。

不能拿完整 key 直接 `includes`（会把上述三条误判为 missing）。测试自证：合成一个不存在的 key（`eslint/no-such-rule-g12-probe`）必须红；对照断言 `react/no-danger` 虽然在 `--rules` 存在，但不在预设（React 归 H5），避免把“决策不启用”误写成“库存不存在”。目的：防止再次出现静默死配置。

### 9. golden / corpus 影响

- golden（`report-v3.json`）扫描 `fixtures/ts` + `fixtures/vue`；1b 规则可能新增诊断（已知候选：`promise/catch-or-return` 命中 `fixtures/ts/no-floating-promise.bad-2.ts` 的 `.then` 链、`array-callback-return` 命中 map fixtures）。实现后以实际 diff 为准，逐条评审再更新 golden。
- corpus：仓库 dogfood config 将默认带 recommended，1b 规则会改变诊断面；`corpus:check` 的 byRule/fingerprint diff 必须逐条归因，评审后 `--save`。不得自动保存。

### 10. 与 G9 的衔接

- 建议顺序：**G12 → G9**。G12 先落 preset/registry category/计数；G9 新增 `no-jsx-dangerous-html`、`no-unsafe-jsx-url`（category=security）后：
  - preset 自动纳入（无需改 presets.ts）；
  - `preset-snapshot.test.ts` 与 rule-count 快照更新 27→29、42→44；
  - corpus 再按 G9 的规则门禁归因。
- 若调整顺序为 G9 → G12，G9 需在仓库 config 显式登记新规则并单独过 corpus 门禁。

## 涉及文件清单

- 改动：`packages/lintsight-config-bridge/src/index.ts`
- 改动：`packages/lintsight-diagnostic/src/registry.ts`
- 改动：`lintsight.config.json`（显式 `preset`）
- 改动：`package.json`（`rule-count` script）
- 新增：`packages/lintsight-config-bridge/src/presets.ts`
- 新增：`packages/lintsight-config-bridge/test/preset-snapshot.test.ts`
- 新增：`packages/lintsight-cli/test/preset-e2e.test.ts`
- 新增：`scripts/rule-count.ts`、`scripts/rule-count.test.ts`
- 新增：`fixtures/preset/*`（空配置坏/好样本）
- 改动：`packages/lintsight-config-bridge/test/config-bridge.test.ts`、`packages/lintsight-diagnostic/test/registry.test.ts`
- 生成物：`plugins/lintsight-rules/index.js`（G9 才变化；G12 不改规则源码）
- golden：`packages/lintsight-cli/test/__golden__/report-v3.json`（评审后更新）
- corpus：`corpus/baseline-v0.json`（评审后 `--save`）

## 规则 / 引擎影响

- 规则 ID / message / messageId / 指纹：**不变**。
- 检测层：不新增规则；1b 为 oxlint 内置规则（owner=oxlint-native）。
- 注册表：新增 category 字段与登记；`registry.test.ts` 扩展。
- builtin-mapping / 预设：新增 preset 展开；`builtinMapping.rules` 保持 `{}`（不作为默认载体）。
- severity：security 预设仅改配置层 severity；`computeFingerprint` 不含 severity，故指纹不变。
- golden/SARIF：报告条目可能因 1b 新诊断变化；SARIF `rules[]` 目录来自 registry（1b 为 oxlint native，现有 SARIF 目录生成逻辑需确认是否收录内置规则；若不收录，保持现状并在文档注明）。

## 测试计划

| 层 | 用例 / 命令 |
| --- | --- |
| 配置单测 | `config-bridge.test.ts`：preset 缺省 recommended、security 提升、none 恢复、非法值 errors、显式 rules 覆盖、等价报告 preset 行 |
| 快照 | `preset-snapshot.test.ts`：recommended 键集 + severity；security 16 条 security=error |
| dead-rule | `preset-snapshot.test.ts` 或独立用例：`oxlint --rules` 校验全部 1b key |
| registry | `registry.test.ts`：category 与 meta 一致；11/16 计数 |
| E2E | `preset-e2e.test.ts`：`{"rules":{}}` 项目 + `fixtures/preset` 坏样本 → 安全诊断；`--fail-on high` low confidence 不拦截；`preset:none` 无自有诊断 |
| 计数 | `bun run rule-count`；`rule-count.test.ts` 快照 |
| 全量 | `bun run test`、`bun run lint`、`bun run format:check`、`cargo test --release`（无 Rust 改动，回归） |
| 语料 | `bun run corpus:check` → 逐条归因 → `--save`；golden 删除重跑并评审 diff |

## 风险与已知坑

1. **默认行为 breaking**：所有已有 config 项目会突然多出 27 条 + 1b 诊断。缓解：`preset:"none"`；变更文档与 README 明确；`security` 需显式选择。
2. **1b 误报**：`promise/catch-or-return`、`array-callback-return` 在语料/真实项目可能有误报；必须走 corpus 门禁，必要时调整清单或降级，不得跳过归因。**已按门禁移出** `eslint/no-await-in-loop`（+420 warning，perf 非安全），待 perf/strict 预设再评估。
3. **死配置**：oxlint 对不存在的规则名静默忽略。防呆必须按 `source+name` 校验；`react/no-danger` 在 1.83.0 存在但默认未启用、需 `plugins`，G12 因插件集覆盖风险不启用，属于决策而非库存缺口。
4. **`plugins` 覆盖默认插件集**：未来加 react/promise 规则时，`plugins` 数组必须包含全部所需插件；G12 明确不碰。
5. **预设与 registry 漂移**：category/defaultSeverity 是单一事实源；registry.test 与规则 meta 对齐；新增规则漏登记会被测试拦截。
6. **G9 改变计数**：预设快照与 rule-count 在 G9 后再更新（27→29、42→44）；G12 验收只锁 27 条基线。
7. **无配置文件边界**：`resolveConfigFile` 返回 null 时 preset 不生效；验收用例必须同时覆盖“无 config”（无自有诊断）与“`{}` config”（27 条 + 1b）；README/发布说明明确该限制，避免把「默认 recommended」误读为所有项目默认开启。
8. **`eslint/no-unsafe-finally`** 已由 correctness 开启，勿重复登记（重复不会报错但会让清单失真）。
9. **`--fail-on low`**：security 预设把 `no-non-literal-fs-filename`（low）设为 error；`--fail-on high` 不拦，但 `--fail-on low/medium` 会拦，README/发布说明需写清。
