# 竖切验证报告：M1 最小闭环（oxlint 基座 + Bun）

> 日期：2026-09-15 · 验证人：引擎研发（AI 协助）· 耗时口径：单日单线程
> 依据：[requirements-v0.2.md](../requirements/requirements-v0.2.md) §11.3 首个竖切 + §8.3 风险清单
> 任务清单：[todo.md](../todo.md)（SV1~SV7，全部完成）
> 环境：Bun 1.4.2 · oxlint **1.83.0**（package.json 精确锁定）· macOS · 全程无 Node.js 依赖

## 总结论

**M1 技术路线可行，可按 §11.3 进入正式竖切开发。**
1 条自有规则 `lintsight/no-empty-catch` 从 CLI 输入 → .ts / .vue → 规则触发 → 带指纹 JSON 报告 → exit code 全链路走通；报告重跑逐字节一致。1 项降级（指纹 messageId 锚点缺失）+ 2 项待补测（bun compile 单文件分发、tsgolint）。

## 结论总表

| # | 验证项 | 对应决策 | 结论 | 说明 |
| --- | --- | --- | --- | --- |
| SV1 | Bun monorepo 脚手架 | DR-7 | ✅ 通过 | workspaces / bun.lock / `bun run cli` / bun test / spawn 全部 Bun 原生，零 Node 依赖；**`bun build --compile` 未测，T0.13 继续跟进** |
| SV2 | oxlint 进程编排 | spike ④ | ✅ 通过（含降级） | JSON 诊断可解析，ruleId/span 可得；**无 messageId 字段** → 指纹降级 |
| SV3 | JS Plugin 自有规则 | DR-1 | ✅ 通过 | alpha 可承载自有规则；ESLint 兼容 API（`create`/visitor/`report`）符合预期；与内置规则同场共存无冲突 |
| SV4 | bun test 承载 RuleTester | 修订④ | ✅ 通过 | 13/13 全绿；用例即契约（3 bad / 2 good / 边界矩阵） |
| SV5 | Vue SFC 虚拟块 + 回映射 | spike ② 核心 | ✅ 通过（最小版） | 1:1 行号对齐方案有效：.vue 内空 catch 映射回原路径 line13/col5 正确 |
| SV6 | 指纹 + exit code + JSON | §5.4/§6.3 | ✅ 通过（含降级） | sha256 指纹跨运行稳定；exit 0/1/2 语义自建（oxlint 退出码有歧义，见下） |

## 关键实证（spike ④ 素材，oxlint 1.83.0）

### 1. JSON 诊断结构（`-f json`）

```jsonc
{
  "diagnostics": [{
    "message": "Unexpected empty catch block...",   // 渲染后文本
    "code": "lintsight(no-empty-catch)",            // 插件名(规则名)，需归一为 lintsight/no-empty-catch
    "severity": "error",                            // warning 时 exit=0，error 时 exit=1
    "filename": "fixtures/ts/x.ts",                 // ⚠️ 相对输入→相对路径；绝对输入→剥掉开头 '/'（见 #3）
    "labels": [{ "span": { "offset": 162, "length": 11, "line": 5, "column": 5 } }]
    // ❌ 无 messageId 字段（内置规则与 JS 插件规则均无）
  }],
  "number_of_files": 6, "number_of_rules": 97
}
```

- span 单位：`offset` 为**字节偏移**、`line/column` 1-based。
- 并行扫描（threads=10）下诊断**顺序不定** → 聚合层按 (file, offset, ruleId) 排序后输出，保证 JSON 与指纹稳定。

### 2. 指纹降级方案（M1 口径修订）

- 设计 v0.2 §5.4：`fingerprint = hash(ruleId + file + span + messageId)`。
- 实测无 messageId → **M1 降级：hash(ruleId + file + span + message 文本)**（sha256）。
- 影响：规则文案变更 = 指纹漂移 = 平台历史对比/抑制同步失效。**「message 文案变更」必须与「messageId 增删改名」同级，纳入 breaking 评审纪律**（rule-authoring skill 已有对应条款）。

### 3. filename 归一化怪癖

相对路径输入 → 返回相对路径；绝对路径输入 → 返回**剥掉开头 `/`** 的路径。桥接层做双候选归一（`packages/lintsight-cli/src/oxlint-bridge.ts`）。

### 4. exit code 矩阵（oxlint 自身）

| 场景 | oxlint exit |
| --- | --- |
| 无诊断 / 仅 warning | 0 |
| 有 error 级诊断 | 1 |
| **输入路径不存在** | **1（歧义！）** |

结论：§6.3 的 0/1/2 语义**必须由封装层自建**——lintsight pipeline 以「输入不存在 / 无可扫文件 / 进程失败 / JSON 不可解析」判定 exit=2，不透传 oxlint 退出码。

### 5. JS Plugins（alpha）能力实证

- 插件名经顶层 `name`/`meta.name` 声明即可获得 `lintsight/` 命名空间（ruleId 归一后符合 `lintsight/<rule-name>` 约定）。
- `meta.messages` + `context.report({ node, messageId })` 正常工作，但 JSON 只回渲染文本。
- 不支持 `.vue`（官方 "can't do yet"）——与 DR-5 自建 VueProcessor 路线一致，本次已 PoC。

## 过程中发现并修复的真实问题（开发摩擦实证）

1. **SFC 内容起始行**：`<script>` 标签后的换行符属于正则捕获内容，起始行需剥离首部换行后再计算。
2. **路径尾斜杠**：`new URL('./', import.meta.url).pathname` 带尾 `/`，`startsWith(root + '/')` 判断静默失效 → 项目根统一去尾斜杠。
3. **`Bun.file().exists()` 对目录返回 false** → 存在性判断改用 `node:fs/promises` 的 `stat`（Bun 兼容）。

## 明确未覆盖（后续工作）

- **spike ①**（oxc crate 直连 PoC，M2 路线）与 **spike ③**（tsgolint / `--type-aware`，类型感知策略）不在本闭环。
- `bun build --compile` 单文件分发（DR-7 收尾项，T0.13）。
- Vue processor 正式版要求：就地临时文件（保 import 解析上下文，§11.2）、safe fix 逆映射回写、多 script 块/TSX。
- no-empty-catch 当前语义：注释占位 catch 也告警（零语句即触发）——正式版评审 `allowComments` 选项。
- 内置规则噪音（如 `eslint/no-unused-vars`）与自有规则的**双报消解**（§3.6）未实现，M1 需注册表。

## 对里程碑的影响

- M0 剩余 spike（①③）与语料库、规则清单评审照常推进，本报告消解了 M1 主链路的最大不确定性。
- 建议将「oxlint JSON 无 messageId」与「oxlint exit=1 歧义」登记进需求文档 v0.3 修订记录。
