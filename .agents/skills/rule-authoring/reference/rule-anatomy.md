# 规则解剖：meta、检测层与轨道

> 本文定义规则的结构契约。字段口径以 docs/requirements/requirements-v0.1.md 的 FR-203/FR-206 为准。

## 检测层选型决策树

```
这条规则要回答的问题需要跨文件信息吗？
├─ 是（跨文件类型/泛型/narrowing）
│    → 不自建。映射到 oxlint --type-aware 规则集（FR-305），
│      在「内置启用映射清单」登记，typeRequirement 标 program
├─ 需要数据流/路径敏感性（污点、可达性、def-use）？
│    → taint 层（M2，Rust 轨道，走 createProgramRule + IR 查询面）
│      前提：L2 CFG/def-use 已建（反模式：跳过 CFG 直接 AST 上写数据流）
└─ 文件内可判定
     ├─ 纯语法/结构可判 → none（JS 轨道，visitor 模式）
     └─ 需局部类型/作用域推导 → local（JS 轨道，用 context.sourceCode 的 scope 分析）
```

JS 轨道（M1）只有 `none`/`local` 两层可用；taint 层规则必须等 M2 深度引擎（FR-302）。

## JS 轨道规则模板（oxlint JS Plugins，ESLint 兼容 API）

```js
// plugins/lintsight-rules/rules/no-token-in-localstorage.js
export default {
  meta: {
    // —— FR-203 完备性契约，缺一 CI 拒合 ——
    category: 'security',              // correctness|security|performance|maintainability|architecture
    severity: 'error',                 // 默认级别，项目配置可覆盖
    confidence: 'high',                // high|medium|low —— CI 门禁只拦 error+high
    typeRequirement: 'none',           // none|local（program 不自建，映射 --type-aware）
    tags: ['cwe-312', 'owasp-a02'],    // CWE 映射逐条核定（本例 CWE-312 明文存储敏感信息；M0 评审时核对）
    docs: {
      description: '禁止将 token/凭证存入 localStorage/sessionStorage',
      rationale: 'XSS 可直接读取 Web Storage，凭证应走 HttpOnly Cookie',
      badExamples: ['localStorage.setItem("token", jwt)'],
      goodExamples: ['后端 Set-Cookie: HttpOnly; Secure'],
      falsePositives: [                // 强制字段：没有误报场景也要写"无已知误报"
        '非敏感的 UI 偏好存储不匹配（仅检测 token/secret/jwt 命名的 key）',
      ],
    },
    fixable: undefined,                // safe | 'suggestion' | 'dangerous' | undefined
  },
  create(context) {
    return {
      CallExpression(node) { /* 检测逻辑，O(n) */ },
    };
  },
};
```

要点：

- **ruleId 命名空间**：`lintsight/<rule-name>`，category 前缀体现在目录结构，不在 id 里重复（oxlint JS Plugins 的物理 id = `<pluginName>/<ruleName>`，category 做不了第二层命名空间；设计文档 v0.2 修订③ 已统一此口径）。
- **meta 不写 `id` 字段（JS 轨道）**：id 由插件名+规则键派生；设计文档 `RuleMeta.id: string` 仅 Rust 轨道/SDK 层需要，JS 轨道作者无需纠结。
- `confidence` 与 `severity` 解耦：severity 说"多严重"，confidence 说"多可信"；CI 只拦 `error + high`（技术设计文档 §4.3）。
- `falsePositives` 是强制字段——写不出来说明你还没想清楚误报边界，回到用例步。
- 消息走 messageId + data，禁止手写拼接文案（多语言与 AI 研判依赖结构化消息）。

## fix 编写纪律（FR-206）

- `safe`：语义等价、作用域内可证——默认进 `--fix`。
- `suggestion`：可能改变行为（如加 await），只出 IDE code action。
- `dangerous`：显式 `--fix-dangerously` 才应用；M3 才铺开。
- fix 产出 `range + text`，同文件多 fix 区间重叠由引擎冲突检测丢弃——规则侧不要自己假设其他 fix 不存在。

## Rust 轨道与 ◆ 升级（M2）

- 深度规则实现 `createProgramRule(ctx)`，经 IR 查询面消费 CFG/DFG/imports（FR-205）；禁止私下建跨文件缓存。
- taint 规则输出必须走附录 C 路径事件模型（`TaintFinding`/`PathEvent`），事件由引擎层产出，规则只声明 source/sanitizer/sink——title 文案由 formatter 按 C.2 模板生成。
- ◆ 规则升级清单（合入前逐项打勾）：
  - [ ] Rust 实现覆盖 JS 版全部用例（用例共享）
  - [ ] 新增路径类用例（source→…→sink 至少 1 条完整 evidenceChain）
  - [ ] 规则注册表：JS 版状态 → retired，owner → deep-engine（§3.6）
  - [ ] 语料库 diff：无双报（FR-407），误报率 <15%（平台复核口径，FR-303 硬门槛）
  - [ ] confidence 上调依据写入 PR 描述

## 性能预算

- 单规则单文件 O(n)；符号反查等索引用 ctx 懒构建索引。
- 热点规则（`--debug timings` 前 10）优先迁移 `createOnce`（per-program 一次 create）。
- 规则内禁止：全量文件扫描、每节点建 Map、同步 IO。
