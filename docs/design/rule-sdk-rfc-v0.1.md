# rule-sdk 接口 RFC v0.1（T1.0a 门禁草案，待评审）

> 日期：2026-09-16 · 状态：**草案** → 评审通过即冻结 M1 接口形状（此后只加不改，v0.2 §3.2 演进纪律）
> 依据：design-m1 §4.5、requirements §3.2 规则接口、§7 Checker 开发指南、铁律 2（禁止依赖 parser AST 类型）
> 配套：[p0-rules-proposal-v0.1.md](p0-rules-proposal-v0.1.md)（规则清单，meta 字段的消费方）
> 落地载体：`packages/lintsight-rule-sdk`（S3 第一项任务 T1.9）

## 1. 目标与原则

- 规则作者**只依赖 SDK 面**（铁律 2）：`defineRule` / `definePlugin` / 类型面 / RuleTester；禁止触碰 oxlint AST 内部类型——解析器可替换的唯一保障。
- 与 oxlint JS Plugins（alpha）1:1 对齐：SDK 是**类型补全 + meta 契约校验 + 测试工具**，不是新运行时。产物即 oxc jsPlugins 可加载的 ESLint v9 兼容插件对象。
- 性能预算：单规则单文件 O(n)（§7.2-5），热点规则迁 `createOnce`（M1 后期，见开放问题 3）。

## 2. API 面

### 2.1 definePlugin / defineRule

```ts
import { definePlugin, defineRule } from '@lintsight/rule-sdk'

export default definePlugin({
  name: 'lintsight',                    // 物理命名空间：ruleId = `<name>/<ruleKey>`
  rules: {
    'no-empty-catch': defineRule({ meta: {...}, create(ctx) { return {...} } }),
  },
})
```

- **meta 不含 id 字段**（JS 轨道）：id 由插件名 + 规则键派生（v0.2 修订③ 口径）；注册表登记时由 SDK 生成全量 id。
- `defineRule` 做两件事：① meta 契约校验（缺字段 throw，错误含字段名——FR-203 缺一拒合，把 CI 拦截提前到加载期）② 类型补全。
- 校验项：`category / severity / confidence / typeRequirement / messages / docs(description+rationale+badExamples+goodExamples+falsePositives)` 必填；`tags`（cwe/owasp）安全类必填；`docs.falsePositives` 空数组也必须显式写出。

### 2.2 RuleMeta（FR-203 契约）

```ts
interface RuleMeta {
  category: 'correctness' | 'security' | 'performance' | 'maintainability' | 'architecture'
  severity: 'error' | 'warning'          // 默认级别，项目配置可覆盖
  confidence: 'high' | 'medium' | 'low'  // CI 门禁只拦 error+high（§4.3）；评级依据见 rule-authoring
  typeRequirement: 'none' | 'local'      // 'program' 不进 JS 轨道（铁律 3，映射 --type-aware）
  tags: string[]                         // 如 ['cwe-798', 'owasp-a02']；安全类必填
  messages: Record<string, string>       // messageId → 文案；文案变更 = breaking（M1-DR2）
  docs: {
    description: string
    rationale: string
    badExamples: string[]
    goodExamples: string[]
    falsePositives: string[]             // 强制字段，无也要显式 []
  }
  fixable?: 'safe' | 'suggestion' | 'dangerous'   // M1 仅类型冻结；fix 结构实测后启用（T1.15）
}
```

### 2.3 RuleContext 与 Visitor（M1 冻结面）

```ts
interface RuleContext {
  options: unknown                                   // 项目配置传入的选项对象
  report(descriptor: ReportDescriptor): void
  // M1 不暴露 sourceCode —— 能力面待 oxlint 兼容层确认后按需追加（开放问题 2）
}

interface ReportDescriptor {
  node: RuleNode
  messageId: string                                  // 必须是 meta.messages 的键（defineRule 校验）
  data?: Record<string, string>
  suggest?: unknown                                  // M1.5：随 fix 结构实测（T1.15）
}

type RuleNode = { type: string; parent?: RuleNode; range?: [number, number] } & Record<string, unknown>
type Visitor = Record<string, (node: any) => void>   // ESLint 兼容 node type 键，含 `Type:exit`
```

- `RuleNode` 是**结构化最小面**：`type/parent/range` + 透传字段。禁止 SDK 类型面出现任何具体 AST 库类型。
- 生命周期边界（对 v0.2 §3.2 的收紧）：M1 冻结 **`create` + visitor**；`onFileStart/onFileEnd` 与 `createOnce` 依赖 oxlint 能力实测（**开放问题 2/3**），确认前 SDK 不承诺；`onProgramEnd / createProgramRule` 是 M2 Rust 轨道钩子，JS 轨道永不出现。

## 3. RuleTester（bun test 承载）

```ts
import { defineRuleTester } from '@lintsight/rule-sdk'

const tester = defineRuleTester({ ruleId: 'lintsight/no-empty-catch' })

const cases = [
  { file: 'fixtures/ts/no-empty-catch.bad-1.ts', expect: [{ line: 5, column: 5 }] },
  { file: 'fixtures/ts/no-empty-catch.good-1.ts', expect: [] },
  // ...
]

describe('lintsight/no-empty-catch', () => {
  const results = await tester.run(cases)   // 一次 oxlint spawn 批扫，按文件返回诊断
  for (const c of cases) {
    test(c.file, () => tester.expect(results, c))  // 数量 + 位置 + severity + ruleId 前缀断言
  }
})
```

- 从竖切 spike 的手写模式（packages/lintsight-cli/test/no-empty-catch.test.ts）工具化而来；断言只看 `lintsight/*` 诊断，内置噪音不进契约。
- 用例即契约（rule-authoring）：≥3 bad / ≥2 good / safe case / 边界矩阵由 `tester.expect` 结构强制（bad 期望非空、good 期望空）。
- fix 断言与 `.vue` 用例断言：T1.15 fix 结构实测后扩展 `expect` 面。

## 4. 版本与兼容策略

- SDK 遵循 **RFC 流程**：任何接口变更（含 meta 新增必填字段）必须先修订本文档并评审——SDK 是插件生态的兼容性生命线（§2.5）。
- `@lintsight/rule-sdk` 0.x 期间允许 breaking（随 RFC 记录）；1.0 起 semver 严格。
- 插件分发校验：引擎加载时校验 `peerDependencies` 的 SDK 版本区间（§2.5），SDK 导出 `SDK_VERSION` 供比对。

## 5. 迁移样例（现有 no-empty-catch → defineRule）

```ts
// 迁移前（裸 ESLint 兼容对象，plugins/lintsight-rules/index.js）
'no-empty-catch': { meta: {...}, create(ctx) {...} }

// 迁移后（defineRule：meta 校验 + 类型补全 + messageId 一致性）
'no-empty-catch': defineRule({
  meta: { category: 'correctness', severity: 'error', confidence: 'high',
          typeRequirement: 'none', tags: [], fixable: undefined,
          messages: { emptyCatch: 'Unexpected empty catch block. Handle the error or rethrow it.' },
          docs: { description: '...', rationale: '...', badExamples: [...], goodExamples: [...], falsePositives: ['注释占位的 catch 也会告警'] } },
  create(ctx) {
    return { CatchClause(node) { if (!node.body?.body.length) ctx.report({ node, messageId: 'emptyCatch' }) } }
  }
})
```

- `plugins/lintsight-rules/index.js` 保持**纯 JS**（oxlint 嵌入式 runtime，禁 Node/Bun API）；`defineRule` 以**构建期复制内联**或独立轻量运行时进入插件文件（实现策略见开放问题 5）。

## 6. 开放问题（随 RFC 评审拍板）

1. meta 校验失败行为：加载期 throw（当前选择）vs 收集诊断统一报错？
2. `sourceCode` 能力（注释查询/文本切片）是否 M1 必需——`no-hardcoded-credentials` 的词法扫描路径可以绕开 sourceCode，但 `allowComments` 选项（T1.13）需要注释访问。倾向：M1 最小暴露 `sourceCode.getText(node)` + `getAllComments()`，以 oxlint 实测为准。
   **已拍板（2026-10-01，spike ③ 实测关闭）**：oxlint 嵌入式 runtime 的 `context.sourceCode` 为**完整 ESLint SourceCode API 面**（`getAllComments`/`getCommentsInside`/`getText`/`getJSDocComment`/tokens 系列全在，注释内容可读，见 [spikes/tsgolint-spike3.md](../spikes/tsgolint-spike3.md) 实测 C）。`allowComments` 已落地（`no-empty-catch`，默认关闭）；SDK 类型面按需渐进暴露，规则可直接经 `context.sourceCode` 访问。
3. `createOnce`（per-program 单次 create）采用时机：M1 默认不用，`--debug timings` 前 10 热点再迁。
4. `fixable` 类型启用节奏：与 T1.15 fix JSON 结构实测联动，M1 末补齐。
5. defineRule 运行时的物理形态：插件文件必须自包含（嵌入 runtime 无 npm 解析）——候选：a) 构建期 bundle（rolldown/esbuild 把 SDK 内联进 index.js）；b) 规则文件手写裸对象 + SDK 仅做类型面。倾向 a（契约校验必须真实执行）。
   **已拍板（2026-09-16，提前实施）**：源码拆分 `packages/rules-core/src/rules/*.js`（每规则一文件，纯 JS）→ `bun run build:rules` 聚合为自包含产物 `plugins/lintsight-rules/index.js`（提交 git，`bun test` 自动重建）；meta 契约校验由测试期 `definePlugin` 对**产物**执行（产物即真实加载物）；产物禁止手改。相对 import 实测不可用（探针：动态规则名未出现在 `--rules`）。规则源 TS 化随 M1.5 评估。
