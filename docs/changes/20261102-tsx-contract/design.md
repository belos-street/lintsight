# Design: G9 TSX/JSX 契约（P0 语法面）

> change-id：`20261102-tsx-contract` · 日期：`2026-11-02`

## 技术设计

### 1. 范围边界

P0 只做**语言/语法面**：

- 解析与扫描：`.tsx` / `.jsx` 进 pipeline、oxlint、Rust 引擎；报告路径/行号/指纹稳定。
- JSX 属性 sink：新增两条自有规则（见 §3）。
- Vue JSX：`<script lang="tsx">` 经 VueProcessor 虚拟化、规则命中、位置回映射。
- 不做 React/Next hooks/server components、React 插件、跨文件 taint、JSX a11y。

### 2. 现状证据（实现前已核对）

| 事实 | 证据 |
| --- | --- |
| `.tsx/.jsx` 在扫描面 | `pipeline.ts` `SCAN_EXTS`；`collectFiles` 按扩展名过滤 |
| 引擎解析按扩展名 | `context.rs` `SourceType::from_path(rel_path)`；`graph.rs` 扩展名表含 tsx/jsx |
| JS Plugins 可见 JSX 节点 | 临时插件 `JSXAttribute` visitor 在 `.tsx` 上报出 2 条（`dangerouslySetInnerHTML`、`href`） |
| 现有规则不覆盖 JSX | `no-innerhtml-assignment` 只处理 AssignmentExpression/CallExpression |
| Vue 支持 tsx | `vue-processor` `lang` 正则含 `tsx`；`VIRTUAL_NAME_RE` 含 `tsx`；虚拟文件后缀取 `block.lang` |
| react 插件不可默认依赖 | `react/no-danger` 在 `--rules` 存在（`no-danger|react`），但默认未启用；启用需 `plugins:['react']`（会覆盖默认插件集），未加 plugins 时探针静默忽略 |

### 3. 新增规则

#### 3.1 `lintsight/no-jsx-dangerous-html`

```ts
meta: {
  category: 'security',
  severity: 'error',
  confidence: 'medium',
  typeRequirement: 'none',
  tags: ['cwe-79', 'owasp-a03'],
  messages: {
    dangerousHtml:
      'Avoid dangerouslySetInnerHTML; sanitize the HTML or use safe DOM APIs. (no-jsx-dangerous-html)'
  }
}
```

- 检测：`JSXOpeningElement` 的 `attributes` 中存在 name 为 `dangerouslySetInnerHTML` 的 `JSXAttribute` → report 该 attribute。
- 不区分 value 是否字面量：该 prop 本身就是 XSS sink；清洗语义静态不可证，统一 medium confidence。
- 命中范围：任意 JSX 元素（内建/自定义组件），因为 prop 会直达 React DOM。
- 不覆盖：Vue `v-html`（G8 的 `no-v-html`）；普通 JS `innerHTML`（既有 `no-innerhtml-assignment`）。

#### 3.2 `lintsight/no-unsafe-jsx-url`

```ts
meta: {
  category: 'security',
  severity: 'warning',
  confidence: 'medium',
  typeRequirement: 'none',
  tags: ['cwe-79', 'owasp-a03'],
  messages: {
    unsafeUrl:
      'Unsafe URL in JSX attribute "{{name}}": javascript:/data: or a dynamic value may enable XSS. (no-unsafe-jsx-url)'
  }
}
```

判定矩阵（`JSXOpeningElement` 名称 + 属性名）：

| 形态 | 处理 |
| --- | --- |
| 任意内建元素 `href`/`src` 字面量归一化后以 `javascript:` 开头 | 报 |
| 任意内建元素 `href` 字面量归一化后以 `data:` 开头 | 报 |
| `src` 字面量 `data:image/png/jpeg/gif/webp`（base64，MIME 小写） | 放行（安全图片 MIME） |
| `src` 字面量 `data:image/svg+xml` 或其他 `data:` | 报（SVG 可携带脚本） |
| `<a>/<area>/<link>` 的 `href` 动态表达式**且名称命中用户可控启发** | 报 |
| `<iframe>/<script>` 的 `src` 动态表达式**且名称命中用户可控启发** | 报 |
| 动态表达式名称不含 user/input/query/search/hash/location/redirect/returnUrl/callbackUrl/params | 不报（P0 精度边界；含 `href={route}`/`href={config.url}`/`href={routerLink}`） |
| `<img>` 的 `src` 为动态表达式 | **不报**（P0 控制误报；字面量危险 scheme 仍报） |
| 动态表达式为模板串且首段锚定 `/`、`#`、`?` | 放行（相对路径，与引擎 `anchored_concat_clean` 同思路） |
| `href={'https://example.com'}`（表达式内字符串字面量） | 视为字面量，放行 |
| `{...props}` spread 属性 | 不分析（P0 边界，文档标注） |
| 自定义组件（首字母大写）上的 href/src | 不分析动态值；字面量危险 scheme 仍报 |

**归一化（必须实现）**：

- 字面量/表达式内字符串先 `trim().toLowerCase()` 再做 scheme 判断：
  - `JaVaScRiPt:alert(1)`、` javascript:alert(1)`、`DATA:text/html,<script>`、`data:IMAGE/SVG+XML,...` 全部命中；
  - 安全 MIME 判定同样用小写：`data:image/png` / `jpeg` / `gif` / `webp`；
  - 大小写/前导空白必须进 fixtures，防止 `startsWith` 直判留下绕过面。
- 表达式内字符串字面量（`href={' javascript:...'}`）走同一归一化。

**动态 URL 名称启发式（G9 精度边界）**：

- 动态表达式仅当 AST 内出现以下命名时报告：`userInput`/`input`/`query`/`search`/`hash`/`location`/`redirect`/`returnUrl`/`callbackUrl`/`urlParam`/`params`。
- `href={userInput}`、`href={req.query.next}`、`src={location.href}` 命中；`href={route}`、`href={config.url}`、`href={routerLink}`、`href={url}` 不报。
- literal `javascript:`/`data:` 不受名称启发式限制（静态可证危险）。
- 该启发式是**保守近似**：漏报非上述命名的用户可控 URL；写入 `falsePositives` 并在 corpus 门禁记录（实测 Ghost 动态 URL 命中 0，避免 53 条路由/配置误报）。

**`data:` MIME 边界（P0）**：

- 放行仅 `data:image/png|jpeg|gif|webp`（base64）；`avif`/`bmp` 暂不放行（当前会报，若 corpus 误报高再回到评审扩表，不在实现中放宽）。
- `vbscript:`、`file:`、`blob:` 不在 P0 覆盖（文档写明）；`javascript:`/`data:` 是 P0 主面。
- `dangerouslySetInnerHTML` 即使 value 是 `DOMPurify.sanitize(...)` 也会报（medium confidence 的设计选择），corpus 抽样确认可接受。

**`docs.falsePositives`（规则实现时必须写入）**：

- `href={route}` / `href={config.url}` / `href={routerLink}` 等非可疑命名不报（P0 精度边界；代价是可能漏报同名用户可控值）。
- `{...props}` 与自定义组件的动态 href/src 不在 P0 检测面。
- `img` 动态 src 不报；`avif`/`bmp` 等 `data:` 图片会报（P0 保守）。

- report 节点 = `JSXAttribute`；`data: { name }` 填属性名（`href`/`src`）。
- 不把 `{{ }}` 当模板；message 采用 ESLint/oxlint 的 `{{name}}` 插值（与现有规则一致）。
- 规则只在 JSX/TSX 文件产生命中；`.ts/.js` 无 JSX 节点即自然空转。

### 4. AST 契约与实现要点

- 依赖 oxlint JS Plugins 的 ESLint v9 兼容 AST：`JSXOpeningElement{ name, attributes }`、`JSXAttribute{ name, value }`、`JSXExpressionContainer{ expression }`。
- 统一从 `JSXOpeningElement` 遍历 `attributes`，避免依赖 `parent` 指针；属性节点用于 report，span 精确落在 prop 上。
- 内建元素判断：`node.name.type === 'JSXIdentifier'` 且 name 全小写；成员表达式（如 `<Foo.Bar>`）与自定义组件不进入动态 URL 判定。
- 表达式动态性：`JSXExpressionContainer.expression` 为 `Literal`/无插值 `TemplateLiteral` → 静态；否则动态。
- 防御：所有节点字段做结构判空，不 cast 到具体 AST 类型（遵守铁律 2 / rule-sdk 面）。

### 5. fixtures 矩阵

| 文件 | 规则 | 期望 |
| --- | --- | --- |
| `fixtures/tsx/no-jsx-dangerous-html.bad-1.tsx` | dangerous-html | 1 条（`<div dangerouslySetInnerHTML={{ __html: html }}>`） |
| `fixtures/tsx/no-jsx-dangerous-html.good-1.tsx` | dangerous-html | 0（普通 children） |
| `fixtures/tsx/no-unsafe-jsx-url.bad-1.tsx` | unsafe-url | 1 条（`<a href={userInput}>`） |
| `fixtures/tsx/no-unsafe-jsx-url.bad-2.tsx` | unsafe-url | 1 条（`href="javascript:alert(1)"`） |
| `fixtures/tsx/no-unsafe-jsx-url.bad-3.tsx` | unsafe-url | 1 条（`<iframe src={location.href}>`） |
| `fixtures/tsx/no-unsafe-jsx-url.bad-4.tsx` | unsafe-url | 1 条（`href=" JaVaScRiPt:alert(1)"` 大小写+前导空白） |
| `fixtures/tsx/no-unsafe-jsx-url.bad-5.tsx` | unsafe-url | 1 条（`src={'DATA:IMAGE/SVG+XML,...'}`） |
| `fixtures/tsx/no-unsafe-jsx-url.bad-6.tsx` | unsafe-url | 1 条（`href={req.query.next}`，名称启发式命中） |
| `fixtures/tsx/no-unsafe-jsx-url.good-1.tsx` | unsafe-url | 0（`https://`、`#anchor`） |
| `fixtures/tsx/no-unsafe-jsx-url.good-2.tsx` | unsafe-url | 0（`` href={`/users/${id}`} `` 锚定） |
| `fixtures/tsx/no-unsafe-jsx-url.good-3.tsx` | unsafe-url | 0（`data:image/png;base64,...`） |
| `fixtures/tsx/no-unsafe-jsx-url.good-5.tsx` | unsafe-url | 0（`href={route}`/`config.url`/`routerLink` 不在启发式） |
| `fixtures/tsx/syntax-basic.tsx` | 解析契约 | 0 parse-error；含 fragment/泛型箭头/spread |
| `fixtures/jsx/*.jsx` | 两条规则 | 与 tsx 对齐的最小 bad/good 各 2~3 条 |
| `fixtures/vue/jsx-sink.vue` | unsafe-url | 1 条，回映射到 `.vue` 行号 |

fixtures 命名沿用现有 `<rule>.<bad|good>-<n>.<ext>`；行/列是契约，禁止格式化。

### 6. 测试计划

| 层 | 用例 / 断言 |
| --- | --- |
| RuleTester | 新增 `packages/lintsight-cli/test/jsx-sink.test.ts`：`defineRuleTester` 逐规则跑 `.tsx/.jsx` 用例；断言 target ruleId 的 line/column；good 用例 0 诊断 |
| Pipeline | `jsx-sink.test.ts` 增加 `runPipeline(['fixtures/tsx','fixtures/jsx'], { cache:false })`：exit=1、无 `internal/parse-error`、两条规则命中、二次运行报告 JSON 逐字节一致 |
| Vue | `jsx-sink.test.ts` 或 `closed-loop.test.ts`：`runPipeline(['fixtures/vue/jsx-sink.vue'])` → diagnostic.file=`fixtures/vue/jsx-sink.vue`，无 `.lintsight-*` 虚拟路径泄漏 |
| Engine | `crates/lintsight-engine/src/rules.rs` 新增测试：`with_context(&allocator, "a.tsx", "const el = <div>{eval(x)}</div>", ...)` → `NoEval` 命中；证明 TSX SourceType 与既有规则可用 |
| Registry | `registry.test.ts`：两条新规则登记、meta.category/severity/confidence/cwe 对齐 |
| Preset | 若 G12 已落地：`preset-snapshot.test.ts` 更新 27→29、42→44；security 预设两条规则为 error；`rule-count` 快照更新 |
| 全量 | `bun run test`、`bun run lint`、`bun run format:check`、`cargo test --release` |
| Golden | `fixtures/vue/jsx-sink.vue` 进入 golden 扫描面 → 删除 `report-v3.json` 重跑，逐条评审新诊断后提交 |
| Corpus | `bun run corpus:check` → 新规则命中按 repo/rule/file 归因；抽样 FP；评审后 `--save` |

### 7. 规则账与预设联动

- registry 两条新条目：
  - `lintsight/no-jsx-dangerous-html`：security / error / medium / cwe-79
  - `lintsight/no-unsafe-jsx-url`：security / warning / medium / cwe-79
- G12 的 `recommended` 默认启用两条；`security` 预设把两条提升为 error（`no-unsafe-jsx-url` 由 warning→error）。
- 若 G12 尚未落地：G9 在 `lintsight.config.json` 显式登记两条规则，保证 corpus 门禁能实际触发；G12 后续按 registry 派生时自动纳入。
- 不新增 1b 内置映射；`react/no-danger` 存在但默认未启用（需 plugins），G9 用自有规则覆盖 `dangerouslySetInnerHTML`；H5 引入 React Profile 时需明确本规则与 `react/no-danger` 的重叠处置（退役自有规则或关闭内置规则），避免双报。

### 8. golden / corpus 影响

- golden 只扫 `fixtures/ts` + `fixtures/vue`；`fixtures/tsx|jsx` 不改变 golden。`fixtures/vue/jsx-sink.vue` 会新增诊断 → golden diff 必须评审。
- corpus 中 Ghost `apps/admin-x-*` 有大量 `.tsx`：`dangerouslySetInnerHTML` 命中应少；动态 `href` 可能较多（warning/medium）。必须输出命中清单（repo、file、rule、案例类型），抽样评估 FP；若 security 抽样 FP ≥10%，回到方案评审收紧判定（不得直接放宽验收）。
- 任何规则行为变化都必须 corpus diff + 评审后 `--save`，禁止自动保存。

## 涉及文件清单

- 新增：`packages/rules-core/src/rules/no-jsx-dangerous-html.js`
- 新增：`packages/rules-core/src/rules/no-unsafe-jsx-url.js`
- 改动：`packages/rules-core/src/index.js`
- 改动：`packages/lintsight-diagnostic/src/registry.ts`
- 改动：`packages/lintsight-cli/test/jsx-sink.test.ts`（新增文件；或独立 pipeline 测试）
- 改动：`packages/lintsight-vue-processor/src/index.ts`（lang 正则最长优先）+ `packages/lintsight-vue-processor/test/vue-processor.test.ts`
- 改动：`crates/lintsight-engine/src/rules.rs`（仅测试）
- 新增：`fixtures/tsx/*`、`fixtures/jsx/*`、`fixtures/vue/jsx-sink.vue`
- 生成物：`plugins/lintsight-rules/index.js`
- 若 G12 已落地：`packages/lintsight-config-bridge/test/preset-snapshot.test.ts`、`scripts/rule-count.test.ts` 快照
- golden：`packages/lintsight-cli/test/__golden__/report-v3.json`
- corpus：`corpus/baseline-v0.json`

## 规则 / 引擎影响

- 规则 ID、category、severity、confidence、CWE：
  - `lintsight/no-jsx-dangerous-html`：security / error / medium / cwe-79 / owasp-a03
  - `lintsight/no-unsafe-jsx-url`：security / warning / medium / cwe-79 / owasp-a03
- 检测层：`none`（纯语法，进程内属性 sink）。
- source/sink/sanitizer：无 taint 表；不迁移 Rust 表。
- 注册表 / builtin-mapping / 预设：新增两条 registry；preset 自动纳入（G12）。
- 指纹 / message / golden / SARIF：新规则独立指纹；新增 SARIF rules[] 条目（registry 驱动）；既有规则无变化。

## 风险与已知坑

1. **动态 URL 误报/漏报**：名称启发式（user/input/query/...）把 53 条 Ghost 路由/配置命中降为 **0**；代价是 `href={url}` 等非可疑命名的用户可控值会漏报。`docs.falsePositives` 已写明，corpus 门禁记录为 0 误报；若未来要求提高召回，回到方案评审引入 taint/Profile。
2. **scheme 归一化遗漏**：必须 `trim().toLowerCase()`；`JaVaScRiPt:`、前导空白、`DATA:`、MIME 大小写均要有 fixture；禁止裸 `startsWith('javascript:')`。
3. **AST 形态差异**：已实测 JSXAttribute 可见；`JSXOpeningElement.attributes` 字段在实现时先做最小探针/测试，若与预期不同，仍从 opening element 遍历属性，不改规则语义。
4. **Vue tsx 虚拟化**：`<script lang="tsx">` 已支持；同行开标签列无法 1:1 → fixture 使用标准换行；多 script 块策略会告警，fixture 只放一个。
5. **默认预设放大影响**：若 G12 已落地，两条规则默认开启；`no-unsafe-jsx-url` 为 warning 不阻断 exit，security 预设才升 error；文档需写清。
6. **与 G8 重叠**：`v-html`/Vue `:href` 归 G8；本规则只做 JSX，避免重复 ruleId/诊断。
7. **React 插件缺口**：不启用 `plugins`（会覆盖默认插件集）；`react/no-danger` 存在但默认未启用；React 框架规则包归 H5/M6。H5 启用 react 插件时需处理与本规则的重叠（双报门禁）。
8. **JSX spread**：`{...props}` 不在 P0 检测面；`falsePositives` 与 docs 明示。
9. **引擎不覆盖 JSX sink**：Rust 轨道只验证解析与既有规则；JSX 属性 sink 由 JS 轨道承担，避免跨轨道语义漂移。
