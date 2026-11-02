# Proposal: G9 TSX/JSX 契约（P0 语法面）

> change-id：`20261102-tsx-contract` · 日期：`2026-11-02` · 状态：已实现（评审整改：scheme 归一化 / FP 边界已补）

## 确认记录

- 2026-11-02：用户评审结论「两份方案整体质量高，可以进入实现」，并要求补：①`javascript:`/`data:` 大小写与空白归一化；②`href={route}` 类误报的可执行边界（corpus FP <10% 硬门禁 + falsePositives 写明）。本方案按此更新后进入实现。

## 背景与问题

- 事实（2026-11-02 仓库核对与实测）：
  - `packages/lintsight-cli/src/pipeline.ts` 的 `SCAN_EXTS` 已包含 `.tsx` / `.jsx`；`collectFiles` 会收集并喂给 oxlint。
  - Rust 引擎 `crates/lintsight-engine/src/context.rs` 用 `SourceType::from_path(rel_path)`，`.tsx/.jsx` 由 oxc 按扩展名解析；`graph.rs` 的扩展名剥离也含 `.tsx/.jsx`。
  - 仓库 **零 `.tsx/.jsx` fixture**（`fixtures/tsx`、`fixtures/jsx` 不存在），零 JSX 专项规则；`no-innerhtml-assignment` 只处理普通 JS 的赋值/`document.write`，不覆盖 JSX。
  - oxlint 1.83.0 JS Plugins 实测可访问 `JSXAttribute` / `JSXOpeningElement`（临时插件探针在 `.tsx` 上报出 2 个属性）；因此自有 JSX 规则可行，不依赖启停 react 插件。
  - `react/no-danger` **存在**于 `oxlint --rules`（`no-danger | react`），但默认未启用；启用需 `plugins:["react"]`，而该字段会覆盖默认插件集（实测 unicorn/promise 失效）。探针未加 `plugins` 时该规则被静默忽略，加 `plugins` 后正常命中 `dangerouslySetInnerHTML` → G9 不依赖 react 插件，自建规则覆盖。
  - `react/no-danger-with-children` 同样存在但不在 G9 范围。
  - Vue processor 已支持 `<script lang="tsx">`（`VIRTUAL_NAME_RE` 含 `tsx`，虚拟文件按 `lang` 生成 `.tsx`），但无 fixture/测试。
  - 关联：upgrade-plan G9 / H8、execution-todo W5 G9、review H8（`dangerouslySetInnerHTML`/`href={userInput}` 实测 0 诊断）。
- 痛点：“支持 TSX/JSX”当前不可验证；React/Preact 的 XSS sink（`dangerouslySetInnerHTML`、动态 `href/src`）不可见；Vue JSX 场景无契约。

## 目标与非目标

- 目标：
  1. **语法契约**：新增 `fixtures/tsx`、`fixtures/jsx`（含 fragment、spread、泛型箭头、JSX 表达式）并由 `jsx-sink.test.ts` + pipeline 测试锁定解析/扫描/确定性。
  2. **JSX sink 规则**：新增两条自有规则：
     - `lintsight/no-jsx-dangerous-html`：命中 `dangerouslySetInnerHTML`（CWE-79）；
     - `lintsight/no-unsafe-jsx-url`：命中 JSX `href/src` 的 `javascript:`/`data:` 字面量与**名称启发式判定为用户可控**的动态 URL（CWE-79）；判定前统一 `trim().toLowerCase()`（覆盖 `JaVaScRiPt:`、前导空白、`DATA:`、MIME 大小写）。
       - 精度边界：动态值仅当 AST 中出现 user/input/query/search/hash/location/redirect/returnUrl/callbackUrl/params 等命名时报告；`href={route}`/`href={config.url}`/`href={routerLink}` 不报（避免 corpus 大面积误报）。literal `javascript:`/`data:` 不受名称启发式限制。
       - `docs.falsePositives` 明示名称启发式的漏报面；corpus 抽样 security FP <10% 为硬门禁。
  3. **Vue JSX 基础用例**：`fixtures/vue/jsx-sink.vue`（`<script lang="tsx">`）经 VueProcessor 虚拟化、规则命中并回映射原 `.vue` 路径。
  4. **引擎解析契约**：Rust 测试用 `.tsx` 路径验证 `SourceType` 与既有规则（如 `no-eval`）可在 JSX 表达式中工作；不新增 Rust JSX sink 规则。
  5. 注册表登记两条规则（category=security），G12 预设自动纳入；若 G12 已落地，更新 preset 快照 27→29、rule-count 42→44。
- 非目标：
  - React/Next 框架语义（hooks、server components、React 插件规则包）→ M6 / H5 Profile。
  - JSX a11y、props 类型检查、跨文件 taint 传播。
  - 不改现有规则 message/messageId/指纹；不重复 `v-html`（G8 归 Vue template）。
  - 不启用 oxlint react 插件；`react/no-danger` 虽存在但默认未启用且需 `plugins` 覆盖默认集，G9 不写死该配置。
  - 不把 JSX 规则塞进 Rust 轨道（P0 只做语法/进程内属性 sink）。

## 方案选型

| 方案 | 做法 | 取舍 | 结论 |
| --- | --- | --- | --- |
| A. 扩展 `no-innerhtml-assignment` | 在既有规则里加 JSX visitor | ruleId/message 语义错位；覆盖 href 更不合理 | 否决 |
| B. 依赖 react 插件 | 启用 `react/no-danger` | 规则存在但默认未启用；`plugins` 覆盖默认插件集；依赖框架门控 | 否决 |
| C. 两条自有 JSX 规则 | `no-jsx-dangerous-html` + `no-unsafe-jsx-url` | 规则 ID/meta 清晰；可独立 confidence/severity；需新增 fixture/registry | **推荐** |
| D. 只做 fixture 不做规则 | 仅锁解析 | 不满足“JSX sink 可命中”；React XSS 仍不可见 | 否决 |

## 影响面清单

- 代码面：
  - `packages/rules-core/src/rules/no-jsx-dangerous-html.js`（新增）
  - `packages/rules-core/src/rules/no-unsafe-jsx-url.js`（新增）
  - `packages/rules-core/src/index.js`（导出登记）
  - `packages/lintsight-diagnostic/src/registry.ts`（2 条登记，category=security）
  - `packages/lintsight-cli/test/jsx-sink.test.ts`（新增）
  - `crates/lintsight-engine/src/rules.rs`（仅测试：`.tsx` 解析 + 既有规则）
- fixtures：
  - 新增 `fixtures/tsx/*.tsx`、`fixtures/jsx/*.jsx`、`fixtures/vue/jsx-sink.vue`
- 契约面：
  - 新增 ruleId / message / messageId（**新增**，不改既有）；指纹新规则独立。
  - 默认预设（若 G12 已落地）：新规则 category=security → `recommended` 开启、`security` 提升 error；corpus/golden 诊断面变化。
  - 无报告 schema / 引擎协议变化。
- 文档面：本 change、execution-todo G9、upgrade-plan（确认后修订 11）、preset 快照说明。
- 测试面：RuleTester、pipeline、Vue 回映射、Rust 解析测试、golden、corpus。

## Breaking Changes

- 新增规则 ID 与诊断（additive）；无既有 ruleId/message/指纹变更。
- 若 G12 已落地，`recommended` 默认会启用两条新规则 → 现有项目新增 JSX 诊断；可用 `preset:none` 或逐条 `off` 关闭。
- `fixtures/vue/jsx-sink.vue` 会进入 golden 扫描面 → `report-v3.json` 有预期 diff（需逐条评审）。

## 验收标准

- `jsx-sink.test.ts`：`.tsx` 与 `.jsx` 的 bad/good 矩阵全绿；`dangerouslySetInnerHTML` 与 `href={userInput}` 均命中；literal `javascript:`/`data:`（含大小写/前导空白变体）命中；安全 URL/锚点/静态路径不误报。
- `no-unsafe-jsx-url` 的 `docs.falsePositives` 必须写明：名称启发式之外的动态值（`href={route}`、`href={config.url}`、`href={routerLink}` 等）不报，可能漏报；corpus 抽样 security FP **<10% 为硬门禁**，不达标回到方案评审收紧范围，不得放宽验收。
- `fixtures/tsx|jsx` 全量 pipeline 扫描：无 `internal/parse-error`，重跑报告逐字节一致；至少一条目标诊断 file/line 稳定。
- Vue fixture：诊断 file 回映射为 `fixtures/vue/jsx-sink.vue`，行号正确；无虚拟 `.tsx` 路径泄漏。
- Rust：`cargo test --release` 新增 `.tsx` 用例通过（`SourceType` 解析 + `no-eval` 命中）。
- 注册表：`registry.test.ts` 校验两条新规则 meta 对齐；G12 preset 快照更新为 29 条（若 G12 已落地）。
- `bun run test`、`bun run lint`、`bun run format:check` 全绿。
- `bun run corpus:check`：新增 JSX 命中逐条归因，抽样 security 误报 <10%；评审后 `--save`；golden diff 逐条评审。
