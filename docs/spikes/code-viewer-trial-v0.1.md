# code-viewer 真实项目扫描报告 v0.1

> 日期：2026-10-11 · 目的：验证 M2 收官后能否对真实业务项目端到端产出完整报告
> 对象：`code-viewer-preview-main`（Vue 3 + TypeScript + Vite，lib / src 双入口，66 源文件 / 4 个 tsconfig）
> 引擎版本：lintsight v0.0.1（oxlint 1.83.0 + lintsight-engine，规则面 JS 25 条 + 引擎 8 条）

## 1. 结论

**可以。** 端到端全链路跑通并产出完整报告（json / text / SARIF），但本轮同时实证出 **1 个 bug + 1 个产品缺口**（§7），当前默认扫描面的信噪比不可接受，需先修复。

| 维度 | 结果 |
| --- | --- |
| 全链路 | ✅ 配置 → M1(oxlint) + M2(engine) → 合并 → json/text/SARIF |
| 双入口（lib + src） | ✅ 正常 |
| Vue SFC 处理 | ✅ 虚拟块 + 诊断行号精确回映射（实测校验，见 §6.1） |
| 嵌套 tsconfig | ✅ 4 个 tsconfig 正确发现（FR-304①） |
| M2 引擎 | ✅ 正常执行（degraded=false），本项目 0 命中（纯前端无 taint sink，符合预期） |
| 报告信噪比 | ❌ 全量扫描 971 条中 655 条（67%）来自构建产物 `docs/assets/` |

## 2. 扫描环境与命令

```bash
# 扫描 A：项目根（默认用法）
bun run cli -- <项目根> --format json --output .lintsight-cache/code-viewer-report.json

# 扫描 B：仅源码目录（规避构建产物）
bun run cli -- <项目根>/lib <项目根>/src --format json --output .lintsight-cache/code-viewer-src.json

# SARIF 输出（GitLab / GitHub Code Scanning 消费面）
bun run cli -- <项目根>/lib <项目根>/src --format sarif --output .lintsight-cache/code-viewer-src.sarif
```

## 3. 总览

| 扫描 | 范围 | 文件 | 诊断 | error / warn | 引擎命中 |
| --- | --- | --- | --- | --- | --- |
| A | 项目根 | 67 | **971** | 969 / 2 | 0 |
| B | lib + src | 43 | **316** | 315 / 1 | 0 |

诊断归属（owner）：扫描 A = oxlint-native 963 + lintsight-js 8；扫描 B = oxlint-native 314 + lintsight-js 2。两次扫描引擎均为 0（独立复验 `runEngine` → `degraded=false`, `diagnostics=0`，非降级吞结果）。

## 4. 诊断构成溯源（扫描 A，971 条）

| 来源 | 条数 | 占比 | 性质 |
| --- | --- | --- | --- |
| `docs/assets/*.js` 构建产物 | 655 | 67.5% | ❌ 打包产物重复计数（噪音） |
| `eslint/no-useless-escape`（源码内） | 250 | 25.8% | ⚠️ 技术正确但低价值（见 §5.1） |
| `eslint/no-unused-vars` | 64 | 6.6% | ✅ 真实（多为低危清理项） |
| 自有规则（真实信号） | 2 | 0.2% | ✅ 真实（见 §5.2） |

> 扫描 B（源码面）316 条 = 250 转义 + 64 未使用变量 + 2 自有规则——即扫描 A 扣除构建产物后的完整构成。

### 4.1 构建产物为何进扫描面

`docs/assets/` 是该项目为 GitHub Pages 提交的 Vite 构建产物（文件名带内容哈希，如 `index-BQWKhZBY.js`）。

- pipeline 的 [IGNORED_DIRS](file:///Users/belos/code/personal/sast-engine/packages/lintsight-cli/src/pipeline.ts#L54-L62) 仅含 `node_modules / .git / .lintsight-cache / dist / build / out / coverage`——`docs/` 不在其中，故被打包产物污染。
- 8 条自有规则命中里有 **6 条落在构建产物**（打包后的 Vue 组件与依赖被重复扫描）→ 全部为误报。

## 5. 发现明细

### 5.1 `eslint/no-useless-escape` ×250（6 个 tokenizer 文件）

| 文件 | 条数 |
| --- | --- |
| `lib/plugin/syntax-highlight/token/java.ts` | 50 |
| `token/c.ts` / `token/go.ts` / `token/python.ts` | 46 / 46 / 46 |
| `token/javascript.ts` | 44 |
| `token/generic.ts` | 18 |

源码还原（`token/generic.ts:17`）：

```js
const regex = /([\w$]+|[\(\)\[\]\{\}\;\:\,\.]|\s+|.)/   // ← 字符类内 \. \( \) 等冗余转义
```

**判定：技术正确、低价值。** 在字符类（`[...]`）内 `(`/`)`/`[`/`.` 等无需转义，规则判定无误；但 tokenizer 正则出于可读性保留转义是常见写法。处置建议：`ignore` 或 severity 降级（依赖 §7 的 B1 修复）。

### 5.2 自有规则 ×2 —— 真实缺陷（同一行，双规则命中）

```
lintsight/no-async-array-method   lib/core/code-viewer.vue:97:1
lintsight/no-array-map-side-effect  lib/core/code-viewer.vue:97:1
```

源码（已人工核对，行号映射精确）：

```ts
props.plugins.map(async (plugin) => await pluginManager.registerPlugin(plugin))
```

**为什么是缺陷**：`Array.prototype.map` 不等待 async 回调，返回的 `Promise[]` 又被丢弃 →

1. 插件注册的异步结果无人等待（调用方可能在插件未就绪时继续执行）；
2. 注册失败会成为未处理的 Promise rejection，静默丢失；
3. 意图是「对每个元素做副作用」→ 应为 `for...of` + `await`（或 `Promise.all` + 保留结果）。

建议修法：

```ts
for (const plugin of props.plugins) await pluginManager.registerPlugin(plugin)
```

### 5.3 `eslint/no-unused-vars` ×64（14 个文件）

`src/App.vue` 12 条最多，`src/example/*.vue` 若干。属低危清理项（未使用的变量/参数），不单独展开。

## 6. 能力验证（本轮实测）

### 6.1 Vue SFC 行映射

诊断 `lib/core/code-viewer.vue:97` 与源码第 97 行逐字对应（人工核对）→ SFC 虚拟块 + 位置回映射正确。

### 6.2 多入口与嵌套 tsconfig

`lib` + `src` 双入口分别传入均正确扫描；项目 4 个 tsconfig（`tsconfig.json` / `app` / `node` / `vitest`）被递归发现并按目录归属（FR-304① 生效）。

### 6.3 SARIF

SARIF 2.1.0 输出通过结构自校验：`results` 引用的 ruleId 集合 ⊆ `tool.driver.rules` 声明集合（316 结果 / 4 声明规则，无悬空引用）。但字段完备性有缺口，见 §7 B2。

### 6.4 退出码

两次扫描均 `exit=1`（有 error 级诊断），与约定一致（0 无 error / 1 有 error / 2 运行错误）。

## 7. 暴露的产品缺口（建议进 backlog）

### B1（bug，高）`ignore` 配置项静默失效

**现象**：`ignore: ["docs/assets/**"]` 完全不生效。两处独立实证：

1. 跨目录：cwd=引擎仓、目标为外部项目绝对路径 → 971 条不变（含改用非锚定 `**/docs/assets/**` 亦然）；
2. 真实接入形态（临时项目：cwd=项目根、配置在项目内、含 `docs/assets/` 与 `src/`）→ `docs/assets/bundle.js` 仍被扫描报告。

**根因**：`config.ignore` 仅被翻译进 oxlintrc 的 `ignorePatterns`（[config-bridge](file:///Users/belos/code/personal/sast-engine/packages/lintsight-config-bridge/src/index.ts#L328-L331)），而 pipeline 是把**绝对路径的显式文件列表**传给 oxlint（`collectFiles` 内 `path.resolve`），oxlint 的 `ignorePatterns` 不作用于该形态；pipeline 自身也没有按 `ignore` 过滤。→ 该配置项目前是**静默无效**的（无任何告警）。

**修复点**：`collectFiles` 收集后按 `config.ignore`（glob）过滤；或在生成 oxlintrc 之外增加 pipeline 侧过滤。附带：`IGNORED_DIRS` 是硬编码常量，与 `config.ignore` 两套机制应统一。

> ⚠️ AGENTS.md 现有注记「oxlint ignorePatterns 对显式传入路径同样生效（实测）」与本轮实证冲突，需一并复核更新。

### B2（缺口，中）构建产物默认进扫描面

`docs/assets` 类提交产物无默认忽略策略，单项目即产生 67% 噪音。建议：默认忽略常见产物特征（`*.min.js`、`dist|build|out|assets` 下带内容哈希的 bundle），或在文档/README 明确「先配 ignore」——但**必须先修 B1**，否则 ignore 形同虚设。

### B3（打磨，低）SARIF 字段偏薄

- `tool.driver.version` 缺失（输出为 `undefined`）；
- `tool.driver.rules[]` 仅含 `id`，缺 `name` / `shortDescription` / `helpUri` / `defaultConfiguration` → GitHub Code Scanning 告警页缺描述与文档链接；
- `informationUri` 为占位地址 `https://github.com/lintsight/lintsight`，需确认是否为有效公开地址。

## 8. 复现

```bash
cd /Users/belos/code/personal/sast-engine
P=/Users/belos/code/personal/test-project/code-viewer-preview-main

# 完整（含构建产物）
bun run cli -- $P --format json --output .lintsight-cache/code-viewer-report.json
# 源码面
bun run cli -- $P/lib $P/src --format json --output .lintsight-cache/code-viewer-src.json
# SARIF
bun run cli -- $P/lib $P/src --format sarif --output .lintsight-cache/code-viewer-src.sarif
```

原始报告产物（gitignore，本地可查）：`.lintsight-cache/code-viewer-report.json`（971）、`.lintsight-cache/code-viewer-src.json`（316）、`.lintsight-cache/code-viewer-src.sarif`。

## 9. 结论与下一步

引擎能力侧**已达可用状态**：能对真实 Vue 业务项目跑通、准确定位、给出带行号的可用诊断，且 M2 引擎按 fail-open 正常工作。阻塞「可直接用于真实项目」的是**输入面治理**（B1 / B2），而非分析能力本身。

建议顺序：修 B1（ignore 生效）→ 补 B2 默认忽略策略 → 用同一项目复扫验收（预期 971 → ≈316，且 ignore 后再降到 ≈66）。
