# oxlint 配置、CLI 与 JS Plugins

> 事实核对基准：oxc.rs 官方文档（2026-09）。与官方文档冲突时以官方为准。

## 配置体系

- 配置文件查找顺序：`.oxlintrc.json` / `.oxlintrc.jsonc` / `oxlint.config.ts` / `oxlint.config.mts`；支持 JSONC 注释。
- `oxlint.config.ts`（JS/TS 配置文件）为**实验性**，需经 Node 运行——lintsight 的 config-bridge 生成 `.oxlintrc.json` 即可，不依赖 TS 配置。
- lintsight 的 `lintsight.config.json` 由 config-bridge 翻译为 `.oxlintrc`（FR-501/FR-201），映射规则保存在 config-bridge 包内并附等价报告。

## category 与规则开关

```
oxlint -D correctness -A no-debugger      # 类别+规则叠加，从左到右
oxlint -A all -D suspicious,correctness   # 先全放行再精确开
```

| category | 语义 | lintsight 默认 |
| --- | --- | --- |
| correctness | 明确错误（默认开） | recommended 基线（FR-201） |
| suspicious | 很可能错误 | M1 试点项目灰度（FR-204） |
| pedantic / perf / style / restriction | 严格/性能/风格/限制 | 不默认开 |
| nursery | 上游不稳定 | **永不默认开**（配置含义会随 oxlint patch 漂移，破坏确定性） |
| all | 除 nursery 外全部 | 仅 strict 预设 |

## 常用 CLI（diagnostic-bridge 与 CI 集成相关）

- `--type-aware` / `--type-check`：启用 tsgolint 类型感知 / 同时输出 TS 编译诊断（可替代 `tsc --noEmit`）。
- ⚠️ `--tsconfig` **对 type-aware 不生效**（type-aware 自动发现 tsconfig）——别用它修 import 解析，走 FR-304 的引擎侧别名兜底。
- `-f json`：diagnostic-bridge 的消费格式；`-f agent`：AI 友好输出（AI 研判对接参考）；`-f sarif`：FR-402 直接可用。
- `--debug timings`：per-rule 耗时（NFR-4 profile 的上游数据源）。
- `--max-warnings`：CI 门禁用（FR-403 退出码语义之上叠加阈值）。
- `--fix` / `--fix-suggestions` / `--fix-dangerously`：对应 FR-206 的 safe/suggestion/dangerous 分级。

## JS Plugins（M1 自有规则宿主）

```jsonc
// .oxlintrc.json
{
  "jsPlugins": ["./plugins/lintsight-rules/index.js", "eslint-plugin-whatever"],
  "rules": { "lintsight/no-token-in-localstorage": "error" }
}
```

关键事实与边界（2026-09）：

1. **兼容 ESLint v9 插件 API**，绝大多数 ESLint 插件开箱即用；官方对 cypress/mocha/playwright/regexp/sonarjs/testing-library 等跑 conformance 快照。
2. 状态 **alpha**——自有规则进 CI 门禁前必须锁 oxlint 版本 + 语料库 diff 门禁（version-policy）。
3. **不支持 processor / `.vue`**（官方列为 "can't do yet"）——Vue 块必须由自建 VueProcessor 预处理后喂入（DR-5，spike ②）。
4. 提供 `createOnce` 高性能 API（per-program 一次 create，非 per-file），热点规则优先用它。
5. 插件名可与内置插件冲突，用 alias 改名（如内置 `jsdoc` 占名时 alias 成 `jsdoc-js`）。
6. spike ② 必测：`createOnce` 生命周期与 onFileStart/onFileEnd 钩子的对应关系、fix（`fix`/`suggest`）行为、自定义插件诊断在 JSON 输出中的 span 精度（诊断 JSON 字段完备性总账归 spike ④，避免双归属）。

## type-aware（tsgolint）

```bash
bun add -d oxlint oxlint-tsgolint@7   # 包管理器为 bun（DR-7）；官方文档示例为 pnpm，等价
oxlint --type-aware            # 类型感知规则
oxlint --type-aware --type-check  # 同时替代 tsc --noEmit
```

- 覆盖 typescript-eslint type-aware 规则 **59/61**（`typescript/*` 命名空间，规则选项同 typescript-eslint）。
- 依赖 **TypeScript 7.0+**；`baseUrl` 等遗留配置不支持——存量项目先跑 spike ③ 实测，不满足则 FR-305 自动降级 `local` 并提示。
- monorepo 需先 build 依赖包产出 `.d.ts` 再扫描（平台长驻 worker 模式要编排这一步，FR-503）。
- lintsight 的 typeRequirement 分级中，`program` 级需求一律映射到"启用 --type-aware 规则集"，深度引擎不自实现（AGENTS.md 铁律 3）。

## 多文件分析

oxlint 原生 project-wide module graph、跨规则共享解析结果（`import/no-cycle` 类规则的性能悬崖已解决）。lintsight 的架构规则（FR-304）优先复用它做 import 图，深度引擎的别名解析兜底只处理 tsconfig `baseUrl`/`paths` 场景。
