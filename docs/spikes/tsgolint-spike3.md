# spike ③ 验证报告：tsgolint 类型感知实测（oxlint --type-aware）

> 日期：2026-10-01 · 验证人：引擎研发（AI 协助）
> 依据：[requirements-v0.2.md](../requirements/requirements-v0.2.md) §11.2「选型 spike ③」+ todo T1.0c（门禁任务）+ T1.13（连带项）
> 复现：`bun add -d oxlint-tsgolint@7` → `node_modules/.bin/oxlint --type-aware -f json <目标>`
> 环境：oxlint 1.83.0 · oxlint-tsgolint@7（内嵌 TypeScript 7，不依赖项目 TS 版本）· macOS

## 总结论

**type-aware 策略定案：直接启用 `oxlint --type-aware`，铁律 3（不自实现 program 级规则）执行确认成立。**
跑通、性能、兼容性三方面数据齐全；T1.0c 关闭，连带 T1.13（allowComments）已实现。

| # | 验证项 | 结论 | 说明 |
| --- | --- | --- | --- |
| 1 | 存量项目跑通 | ✅ 通过 | 三类形态全跑通：现代 tsconfig（zod）、**无 tsconfig JS 仓库（dayjs）**、monorepo 未 build .d.ts（zod packages） |
| 2 | 存量 tsconfig 兼容性 | ✅ 通过（含坑） | TS7 移除的选项（`downlevelIteration`/`baseUrl`/`paths`）→ `typescript(tsconfig-error)` error 诊断，**不阻断扫描** |
| 3 | 延迟开销 | ✅ 可接受 | dayjs 165→228ms（+38%）/ zod src 310→381ms（+23%），type-aware 命中密度越高开销越低 |
| 4 | `no-misused-promises` 生效性 | ✅ 生效 | ⚠️ `--rules` 表三列全空 ≠ 不可用（详见实证 #1） |
| 5 | type-aware 规则覆盖 | ✅ 59/61 口径成立 | 默认开一批；其余（`no-misused-promises`/`switch-exhaustiveness-check`/`no-unnecessary-condition`…）显式启用即工作 |
| 6 | 普通规则共存 | ✅ 通过 | `eslint/no-unused-vars` 与 typescript/* 同报告同场输出 |
| 7 | 注释访问能力（RFC 开放问题 2） | ✅ sourceCode 完整可用 | `getAllComments`/`getCommentsInside`/`getText`/`getJSDocComment` 全套（实测 C）→ T1.13 落地 |

## 关键实证

### 1. `--rules` 表格的语义陷阱（重要）

`oxlint --type-aware --rules` 中 `no-misused-promises` 三列全空（Default/Enabled?/Fixable 均无标记），
**曾误导性暗示不可用；实测显式启用（`.oxlintrc` 规则键 `typescript/no-misused-promises: "error"`）后完全生效**：

```
type-aware-cases.ts:12:7  typescript(no-misused-promises)   ← if 条件中的 Promise
type-aware-cases.ts:18:27 typescript(no-misused-promises)   ← forEach 里的 async 回调
```

- 全空 = **非默认类别**（需显式启用），非"未实现"。
- 类型感知规则启用方式 = 普通 rules 键（`typescript/<name>`），与内置规则同机制（config-bridge 零改动兼容）。

### 2. 真实语料跑通 + 延迟

| 目标 | 普通扫描 | --type-aware | 开销 | typescript/* 命中 |
| --- | --- | --- | --- | --- |
| dayjs src+types（222 文件，**无 tsconfig**） | 165ms / 8 条 | 228ms / 42 条 | +38% | 34 条（unbound-method 20、no-redundant-type-constituents 11，多在 .d.ts） |
| zod packages/zod/src（241 文件，monorepo **未 build .d.ts**） | 310ms / 1752 条 | 381ms / 1753 条 | +23% | 9 条（no-extraneous-class 8 + tsconfig-error 1） |

- **无 tsconfig 项目直接跑通**（tsgolint 自建推断 Program）——存量 JS 仓库无需准备。
- 二次跑无加速（216ms≈228ms）：**tsgolint 无跨进程缓存，每次冷起**——type-aware 的增量/缓存策略须引擎侧自建（M2 缓存体系范围）。

### 3. 兼容性坑（FR-304 的输入）

- `downlevelIteration`：`Invalid tsconfig … Please remove it from your configuration`（tsgolint#351）。
- `baseUrl` + `paths`：双双 `Invalid tsconfig`（tsconfig 第 4/5 行各一条）——**别名解析在 type-aware 下确认失效**，FR-304 引擎侧别名兜底必要性实证。
- 坑的表现形式 = **error 级 `typescript(tsconfig-error)` 诊断**，不阻断、不崩溃；但会混进报告与指纹基线——**桥接层须过滤或降级该 ruleId**（建议：diagnostic 桥接按 ruleId=typescript(tsconfig-error) 归 warning + 不参与门禁计数，M2 首批处理）。

### 4. 注释访问能力（实测 C，T1.13 / RFC 开放问题 2）

JS Plugins 嵌入式 runtime 的 `context.sourceCode` 为**完整 ESLint SourceCode API 面**
（`text`/`ast`/`scopeManager`/`getAllComments`/`getCommentsBefore|After|Inside`/`commentsExistBetween`/`getJSDocComment`/tokens 系列全在），
`getAllComments()` 返回值含注释文本内容，`getText()` 可用。探测方法：插件 report message 携带 `JSON.stringify(context/sourceCode 结构)` 带出沙箱。

→ **`allowComments` 选项落地**（T1.13 关闭）：
- `no-empty-catch` 新增选项 `allowComments`（默认 `false`，行为不变）；空 catch 内含注释 = 显式"有意忽略" → 放行。
- RuleTester 顺手补 **per-case options 基建**：case 带 options 时按选项分组叠加生成独立 oxlintrc（复用 T1.8 实测的选项数组语义），每组一次 spawn 并行执行。
- fixtures 约定新增：**选项组用例放 `fixtures/options/`**（不进 closed-loop/golden 全量扫描面——选项用例以默认配置被扫会污染竖切断言与 golden）。
- 验证：7/7（默认组 5 + 选项组 2）；语料库基线一致（默认行为零变化）。

## 类型感知策略定案（回答 requirements §2.2 的执行确认）

1. **铁律 3 成立**：`program` 级需求 = 启用 `--type-aware` 规则集，深度引擎不自实现——规则面、性能、共存性全部实证。
2. **启用方式**：oxlint-tsgolint@7 伴生依赖 + `.oxlintrc` 规则键显式启用（默认集之外的可按需开）。
3. **存量项目双门槛**：① TS7 移除选项 → tsconfig-error 诊断（不阻断，桥接层降级处理）；② 别名解析失效 → FR-304 兜底。monorepo 建议 build 后扫描（FR-503 平台 worker 编排）。
4. **无缓存**：tsgolint 每次冷起，type-aware 文件级缓存归引擎缓存体系（M2，键口径不变——type-aware 诊断同样内容确定）。

## M1 收尾账目更新

- T1.0c（spike ③）：✅ 本报告，M1 门禁任务全清。
- T1.13：✅ `allowComments` 选项落地（本报告 §4），S4 全清。
- T1.19（内部 ≥3 项目试用）：**M1 唯一遗留**，需人力执行。
