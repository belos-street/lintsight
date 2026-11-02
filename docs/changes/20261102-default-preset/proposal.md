# Proposal: G12 默认 recommended/security 预设

> change-id：`20261102-default-preset` · 日期：`2026-11-02` · 状态：已实现（评审整改：无 config 边界 / effective 口径 / dead-rule 匹配已钉死）

## 确认记录

- 2026-11-02：用户评审结论「两份方案整体质量高，可以进入实现」，并要求先钉死：①无配置文件行为；②`effective` 必须包含 1b；③dead-rule 按 source+name 匹配；附 Low 文档项。本方案按此更新后进入实现。

## 背景与问题

- 事实（2026-11-02 仓库核对）：
  - `packages/lintsight-config-bridge/src/builtin-mapping.ts` 中 `rules: {}`，仅 `categories.correctness='error'`。
  - 27 条自有 JS 规则（11 正确性 + 16 安全，清单见 design §1）默认全关；空配置（`{"rules":{}}`）项目只跑 oxlint correctness 基线 + 引擎 6 条常驻规则（`no-eval`/`no-path-traversal`/`no-command-injection`/`no-ssrf`/`no-prototype-pollution-merge`/`no-open-redirect`）。
  - `translate()` 只做 `builtinMapping.rules` + 用户 `rules` 合并，没有 preset/recommended/security 概念；`validateConfig` 也没有 `preset` 字段。
  - 1b 清单与 oxlint 1.83.0 实际库存有偏差（`oxlint --rules` + 探针实测）：
    - `react/no-danger` **存在**于 `oxlint --rules`（`no-danger | react`），但默认未启用；启用需 `plugins:["react"]`，而该字段会覆盖默认插件集（实测 unicorn/promise 失效）。本方案仍不启用（React Profile 归 H5），并在 dead-rule 防呆中记录“存在但不在预设”而非“不存在”。
    - `react/no-danger-with-children` 存在，同样不启用。
    - `eslint/no-unsafe-finally` 已被 correctness 类别默认启用，不属于缺口。
    - 可用且显式启用后可命中的 1b：`eslint/no-new-func`、`no-throw-literal`、`no-fallthrough`、`array-callback-return`、`no-promise-executor-return`、`no-proto`、`no-prototype-builtins`、`promise/catch-or-return`、`unicorn/no-document-cookie`（9 条）。
    - `eslint/no-await-in-loop` 可用但 **已移出默认预设**：corpus 实测 +420 warning（perf 非安全，稀释信号），待 perf/strict 预设再评估。
  - 关联条目：upgrade-plan G12 / H1、execution-todo W3 G12、requirements FR-201/FR-204、P0 规则提案 §1b。
- 痛点：新项目开箱只有 correctness lint，安全价值不可见；用户需手抄 27 条规则；没有 recommended/security 两档；1b 映射未落地。

## 目标与非目标

- 目标：
  1. 新增配置字段 `preset: "recommended" | "security" | "none"`，缺省 `recommended`。
  2. **无配置文件边界（钉死）**：`preset` 只在存在 `lintsight.config.json` / `--config` 时生效。无 config 项目**不生成默认配置**，行为保持现状（oxlint correctness + 引擎 6 条常驻；自有 JS 规则 0 启用）。理由：G12 不改自动发现行为；需要 preset 的项目显式建 config。该边界必须有 E2E 断言 + README/发布说明明确，避免「默认 recommended」被误读为所有项目默认开启。
  3. `recommended`：启用全部 27 条 active 自有 JS 规则（severity 取 registry `defaultSeverity`）+ 核实可用的 1b 内置规则。
  4. `security`：在 recommended 覆盖面上，把 16 条自有安全规则与安全语义的 1b 规则提升为 `error`；low confidence 规则仍按 confidence 过滤，不进入 `--fail-on high`；文档提醒 `--fail-on low` 仍会拦截。
  5. 注册表新增 `category` 字段作为预设单一事实源（11 correctness / 16 security）；G9 新增规则登记后自动进入预设。
  6. 新增 `rule-count` 脚本（registered / enabled / effective 三口径；**effective = enabled + engineResident**，含 1b）与预设快照测试。
  7. 空配置（`{"rules":{}}`）项目扫描已知坏样本能出安全诊断；`preset:"none"` 可恢复现状。
- 非目标：
  - 不新增规则（JSX sink 归 G9）；不改任何现有规则 message / messageId / 指纹。
  - 不启用 react 插件、不做 profile 门控（`react/no-danger` 存在但默认未启用且启用需 `plugins` 覆盖默认集；React Profile/RulePack 归 H5）。
  - 不改变无配置文件项目的自动发现行为（pipeline 只在 config 存在时生成 oxlintrc）；该边界已上升为显式验收与发布说明，不是隐含假设。
  - 不做 `strict` 或可组合 `extends` 预设；不引入 nursery。

## 方案选型

| 方案 | 做法 | 取舍 | 结论 |
| --- | --- | --- | --- |
| A. 直接填 `builtinMapping.rules` | 把 27 条 + 1b 全量写死为默认启用 | 无两档；所有配置无条件启用；与 registry 漂移 | 否决 |
| B. `preset` 字段 + registry 派生 | `recommended/security/none` 三档；按 registry category/severity 展开 | 单一事实源；G9 新规则自动纳入；配置契约新增字段 | **推荐** |
| C. `extends: ["recommended"]` 数组 | ESLint 风格可组合 | 当前只有两档，顺序/冲突语义成本高 | 否决 |

## 影响面清单

- 代码面：
  - `packages/lintsight-config-bridge/src/index.ts`（`LintsightConfig`、`validateConfig`、`translate`、等价报告）
  - 新增 `packages/lintsight-config-bridge/src/presets.ts`
  - `packages/lintsight-diagnostic/src/registry.ts`（`RegistryEntry.category` + 27 条登记）
  - 新增 `scripts/rule-count.ts`、`package.json` script
  - `lintsight.config.json`（显式声明 `preset`）
- 契约面：
  - 配置 schema 新增 `preset`；报告 schema / 诊断字段 / 指纹 / ruleId / message 均不变。
  - **默认启用面变化**：`rules:{}` 项目从“自有规则 0 启用”变为 27 条 + 1b；属 breaking behavior。
  - `security` 预设会改变自有安全规则的报告 severity（配置层，不改规则 meta）。
- fixtures：新增 `fixtures/preset/` 坏/好样本（空配置 E2E 用）。
- 文档面：本 change、execution-todo G12、upgrade-plan（确认后修订 11）、`lintsight.config.json` 注释。
- 测试面：config-bridge 单测、预设快照、dead-rule 防呆、E2E、rule-count、golden、corpus。

## Breaking Changes

- 配置缺省行为变化：存在 config 文件且未写 `preset` 时默认 `recommended`；`rules:{}` 不再等于“全关”。需 `preset:"none"` 恢复。
- 1b 内置规则默认启用 → 新增诊断/可能改变 exit code；golden 与 corpus 基线需评审后重建。
- 无规则文案/ID/指纹变化；无报告 schema 变化。

## 验收标准

- `config-bridge.test.ts`：preset 缺省/三档/非法值/显式覆盖/`preset:none` 全绿。
- 新增 `preset-snapshot.test.ts`：recommended 快照含 27 条自有规则 + 1b 清单；security 快照中 16 条安全规则均为 `error`。
- 新增 `fixtures/preset` E2E：空配置（`{"rules":{}}`）坏样本产出 `lintsight/no-hardcoded-credentials`、`eslint/no-new-func` 等安全诊断；**无 config 项目仍只有 oxlint correctness + 引擎 6 条**（显式断言）；`--fail-on high` 下 low confidence 规则不拦截，`--fail-on low` 拦截。
- 新增 dead-rule 防呆：解析 `oxlint --rules` 的 `source | rule name` 两列，按 source+name 匹配（不能拿 `eslint/no-new-func` 全名直接 `includes`）；删/伪造 key 必须红。
- `bun run rule-count` 输出 registered/enabled/effective 三口径；`effective = enabled(own+builtin) + engineResident`：recommended = 27+9+6=42，none = 6，G9 后 = 29+9+6=44；`rule-count.test.ts` 快照。
  - 偏差说明：corpus 实测 `eslint/no-await-in-loop` 新增 **+420 warning**（顺序 await 的 perf 提示，非安全面，稀释安全信号）→ 从默认预设移出，待 perf/strict 预设再评估；因此 builtin 为 9（而非 10）。
- `bun run test`、`bun run lint`、`bun run format:check` 全绿；`cargo test --release` 不受影响。
- `bun run corpus:check` 的漂移逐条归因（1b 新增诊断）并经评审 `--save`；golden diff 逐条评审。
