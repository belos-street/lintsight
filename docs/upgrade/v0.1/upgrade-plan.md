# lintsight JS/TS 引擎升级评估与计划（v0.1 修订 5）

> 状态：评审稿 · 日期：2026-10-29 · 项目版本：0.1.0-alpha.0
> 本文由「升级计划 v0.1」与「M1-M3 交付评估」合并，并采纳 [独立评审报告 v0.1](review-report-v0.1.md)，作为 M4 立项、scanner 集成与替代验收的基线文档。
> 依据：M1/M2/M3 交付、cleancode-sast-web 真实扫描（445 文件 / 183 个 `.vue`）、juice-shop 召回对照、6 仓库语料基线、当前代码与测试实测。
> 读者：引擎研发、scanner / 平台团队、技术决策者。

---

## 0. 评审结论（独立评审 v0.1 复核后）

**一句话**：lintsight 当前是「oxlint 正确性 lint + 小规模过程内 taint + 证据链骨架」，不是「可替代现有 JS/TS SAST 的检测引擎」；工程质量不能抵消检测深度与评估证据的不足。

| 视角 | 总分 | 判断 |
| --- | --- | --- |
| **MVP 视角** | **6.0 / 10** | 可试点：能扫描真实仓库、输出 JSON/SARIF、指纹稳定、工程纪律扎实；适合缺口发现与内部试用 |
| **企业级替代视角** | **3.3 / 10** | 未就绪：检测深度停在 D2、无跨过程/框架语义、无可复核的精确基准、增量缓存不正确、契约字段缺失 |

> 口径说明：此前本计划的 6.8 是单视角加权；独立评审按「MVP / 企业替代」双视角给出 6.0 / 3.3。**采纳后者作为评审基线**，差异主要来自精度证据（5.0 vs 7.0）与框架扩展性（4.5 vs 6.0）。评分不确定性约 ±0.5（bench 与语料未重跑）。

### 0.1 评分卡（独立评审口径，权重合计 100）

| 维度（权重） | MVP | 企业替代 | 核心证据 |
| --- | --- | --- | --- |
| SAST 检测深度与规则覆盖（25） | 5.5 | 3.0 | 自有 27 JS + 9 engine；仅 5 条过程内 taint；语料 3453 条中引擎 14 条（0.41%）；`fs.readFileSync(req.query.file)` 0 命中 |
| 精度/召回与评估方法（20） | 5.0 | 2.5 | 27/27 规则有 `falsePositives`、语料/双报/golden；但 juice-shop 是「锚点文件内任意规则命中」（17/26，总口径 17/111），无逐行标注/负样本 |
| 架构设计与可演进性（20） | 7.0 | 4.0 | 包级分层清晰、sidecar/排序/指纹合理；但缓存键不含路径、干净文件不缓存、图规则只跑 miss、Rust 规则直接依赖 oxc AST |
| 工程质量/测试/CI（15） | 7.5 | 4.5 | 167 bun + 52 cargo 全绿、golden/fixture/注册表齐备；但无 CI、`bun run test` 不含 cargo、无 fuzz/超时/大小上限 |
| 平台契约与集成（10） | 6.0 | 3.5 | JSON/SARIF/fingerprint/exit/pathEvents 已具备；但无 confidence/cweTags/`--fail-on`/engineStatus/toolVersion，SARIF 无 taxonomies/suppressions |
| 框架扩展性与解耦（10） | 4.5 | 2.0 | Vue processor 独立包；但 `.vue` 硬编码、template 不分析、TSX/JSX 零 fixture、无 Profile/Processor/RulePack |

**加权总分**：MVP ≈ 5.95 → **6.0**；企业替代 ≈ 3.275 → **3.3**。分差主要来自检测（−0.625）、评估（−0.5）、架构（−0.6）、框架（−0.25）。

### 0.2 三个决定性差距（按企业替代影响排序）

1. **检出深度与覆盖不足**：仅过程内 taint，5 条 taint 规则；path-traversal 的 source 仅 `fs.readdirSync`，命令/SSRF 仅 `req/ctx` 名字；SQL 仅有语法版 `no-sql-concat`，无 ORM/NoSQL/XXE/反序列化 taint；无 Vue template、无 JSX sink；`req→fs` 直测 0 命中。
2. **精度/召回证据不成立**：无逐行标注、无逐规则 TP/FP/FN、无独立复核；juice-shop 分母是「可静态锚定 26 个」，判定是「锚点内任意自有规则命中」；语料 54.8% 是 `no-unused-expressions`/`no-unused-vars`，引擎仅 0.41%。
3. **增量缓存与契约不可信**：缓存键不含文件路径导致同内容文件诊断错配；干净文件永不入缓存；图规则只看到缓存未命中文件；输出无 confidence/cweTags/fail-on，引擎缺失静默降级。

### 0.3 关键决策摘要

| 决策 | 结论 | 理由 |
| --- | --- | --- |
| TSX/JSX 是否纳入 | **是，语言面 P0** | 解析器与扫描扩展已支持，但零 fixture、零 JSX 专项规则，属于「有代码无契约」 |
| Angular/React 是否现在做 | **否，需求门控 P2** | 框架语义建模成本高；先做目标栈 Vue + 后端，Angular/React 待真实目标仓 |
| 后端框架是否建模 | **是，P1** | 公司后端以 Nest/Express 为主；框架建模是 taint 精度的前提，不能靠硬编码 source 名字 |
| Rust 安全规则是否太少 | **是，明显偏少** | 当前仅 5 条 taint + 1 条语法；建议 M5 前扩到 15~20 条 Rust 安全规则，其中 10~12 条数据流 |
| 是否追求规则数量 | **否，追求覆盖矩阵** | 注册/启用/有效三口径差异巨大；不以规则数对外宣传 |
| 默认安全规则集 | **必须新增 recommended/security 预设** | 当前 `builtin-mapping.rules={}`，27 条 JS 规则（11 正确性 + 16 安全）默认全关；引擎可用且文件为 cache miss 时 6 条常驻规则（含 5 taint）仍运行，但缺 Vue/框架规则与推荐预设 |
| 增量缓存 | **先修正确性再谈性能** | 键缺路径、空结果不缓存、图规则只跑 miss，会破坏冷/热扫一致性 |
| 输出契约 | **补 confidence/cweTags/fail-on/engineStatus/toolVersion** | 需求 §4.3 的「CI 只拦 error+high」当前无法实现 |
| 配置根与路径 | **新增 `--root`/cwd 契约** | scanner 不 chdir 时配置发现与报告路径不可控 |
| 版本号 | **单一版本源** | CLI 0.0.1 / 根 0.1.0-alpha.0 / 引擎 0.1.0 三处漂移 |

### 0.4 独立评审采纳记录

| 评审项 | 采纳状态 | 落点 |
| --- | --- | --- |
| B1 检出深度/覆盖不足 | 采纳 | M5 D3 + §5.3 规则扩充 |
| B2 增量缓存不正确 | 采纳 | G1 扩展（路径/空结果/图规则/冷热等价） |
| B3（= 报告 H3 升级）契约不可信 | 采纳 | G2 + G6（confidence/cweTags/fail-on/degraded/toolVersion/inline suppression） |
| H1 27 条 JS 规则（11 正确性 + 16 安全）默认全关 | 采纳（引擎可用且文件为 cache miss 时 6 条常驻规则仍运行） | 新增 G12：recommended/security 预设 + 1b 映射 |
| H2 Vue template + 整条抑制 | 采纳 | M4 Vue template v1；G8 明确「抑制仅过渡」 |
| H4 精度/召回/覆盖矩阵 | 采纳 | M4 基准 v1 + §6 |
| H5 框架扩展仍是改内核 | 采纳 | §3.4 + M4 Profile v0 |
| H6 CI/健壮性 | 采纳 | G3 + G5 扩展 |
| H7 Rust 铁律 #2 名义兑现 | 采纳 | G4 |
| H8 TSX/JSX 无契约 | 采纳 | M4 语言面 P0 + G9 |
| H9 配置/路径不适配 scanner | 采纳 | 新增 G13 |
| M1 版本三处不一致 | 采纳 | 新增 G14 |
| M2 基线陈旧/语料偏科 | 采纳 | G3 + 重建 bench/corpus 基线 |
| M3 无 inline suppression | 采纳 | G2 扩展 |
| M4 Vue 虚拟路径进入图身份 | **已复现** | G15（Vue→TS 环 0，TS→TS 对照 2） |
| M5 opt-in 规则无对账 | 采纳 | G17 |
| M6 arch glob 能力与文档不符 | 采纳（文档+增强） | G16 |
| M7 默认忽略误伤/不足 | 采纳（可配置+告警） | G16 |
| M8 依赖/供应链 | 采纳 | G11 |
| M9 重复输入导致引擎诊断重复 | **已复现** | G16 回归用例（`src src` → 引擎诊断 ×2） |
| L1-L4 文档/SARIF/发布/clippy | 采纳（低优先级） | G11/G14/CI |

### 0.5 评审分歧与口径修正

- **「任意 processor 字符串触发 Vue 虚拟化」不准确**：`config-bridge` 的 `hasVueProcessor` 只触发 `suppressVueUnusedVars`；`.vue` 虚拟化在 `pipeline.ts` 无条件发生。结论「processor 不分发、配置耦合」成立，但描述需修正。
- **「900」应标历史快照、不可复现，不作为口径**：当前实测为 908 行输出 / 877 表格行 / 870 类别合计 / 807 唯一规则名 / 123 启用；不要把 900 当规则数。
- **「空配置项目仅 no-unused-vars」是样本观察**：真正问题是 `rules={}` 导致 27 条 JS 规则（11 正确性 + 16 安全）默认 0 启用、缺少 recommended/security 预设；但引擎可用且文件为 cache miss 时 6 条常驻规则仍运行，不能说「安全价值为 0」。
- **「引擎缺失 degraded=false」是设计冲突，不是纯实现 bug**：代码与 `engine-bridge` 注释一致，但与 `design-m2 M2-DR3` 的 `degraded:true` 矛盾；采纳为契约/可观测性缺陷（G6）。
- **「无 SQL」表述需精确化**：存在语法版 `no-sql-concat`；缺的是 SQL/ORM/NoSQL 的 taint 版，而不是完全没有 SQL 规则。
- **「M9 重复输入」已复现**：`runPipeline(['src','src'])` 下引擎 `no-eval` / `no-path-traversal` 各重复 2 条；`eslint/no-eval` 仅 1 条（oxlint 侧可能去重）。计划从「待验证」升级为 G16 回归项。
- **评分是判断而非事实**：6.0 / 3.3 是严格评审口径，±0.5；若补齐证据与契约，分数应上调，而不是靠文档改写。

### 0.6 如果只做三件事

1. **修缓存正确性 + 契约 v3 + CI**：否则 scanner 接入第一天就会被热扫错报/漏报和无法门禁打回。
2. **做 D3 + 扩 source/sink + Vue template/JSX sink**：这是「能检出」的核心。
3. **建逐行标注基准 + 覆盖矩阵 + 双跑**：这是「能被信任/能替代」的证据。

---

## 1. 目标与组件边界

### 1.1 核心目标

lintsight 作为**纯 JS/TS 检测引擎**，被现有 `scanner` CLI 集成为 `JavaScript` 语言引擎，替代原有 JS/TS 引擎。

- **lintsight 负责**：文件发现与过滤、解析、规则执行、数据流/跨文件分析、Vue SFC 语义、框架语义 profile、诊断模型与指纹、证据链、JSON/SARIF 输出、退出码、引擎级缓存、性能。
- **scanner 负责（不在本计划范围）**：多语言引擎编排、平台配置解析、Task/报告/缺陷上传、基线/抑制同步、AI 研判调度、CI/CD 集成、扫描机调度。
- **非目标**：平台协议、报告上传、任务生命周期、CI/CD、基线/抑制、策略中心、AI 研判、多语言共存。

### 1.2 「替代口径」拆成四层，避免一句空话

| 层级 | 验收含义 | 当前状态 |
| --- | --- | --- |
| L1 规则账目 | 现有引擎规则清单 100% 有结论（实现 / 映射 / 缺口 / 豁免） | ❌ 未建，现有引擎规则目录不可见 |
| L2 双跑一致 | 同 commit 诊断（文件 + 行 + 规则映射）对齐率 ≥ 95%，差异逐条归因 | ❌ 未跑 |
| L3 质量对齐 | 召回不低于现有引擎基线；correctness 误报 <5%、security <10% | 🟡 仅有单项目自标注，无独立基准 |
| L4 工程契约 | 确定性输出、指纹稳定、exit 0/1/2、SARIF/JSON 可被 scanner 无改造消费 | 🟡 基本具备；缺 confidence/cweTags 与热/冷扫一致性 |

**结论**：M4 的「替代验收」必须先完成 L1 + L2；L3 需要独立标注基准；L4 需要补契约与 CI。

### 1.3 职责边界（继承 v0.1）

| 职责 | scanner | lintsight 引擎 |
| --- | --- | --- |
| 解析平台 YAML / taskKey / server | ✅ | ❌ |
| 多语言引擎调度与结果合并 | ✅ | ❌ |
| 报告/缺陷上传、基线、抑制同步 | ✅ | ❌ |
| AI 研判调度 | ✅ | ❌ |
| 调用引擎：扫描根、排除项、规则启停、并发 | ✅ | 消费参数 |
| 文件发现、忽略过滤、构建产物跳过 | 传入扫描面 | ✅ |
| 解析、规则、taint、跨文件分析、Vue/框架语义 | ❌ | ✅ |
| 诊断模型、指纹、证据链、JSON/SARIF、退出码 | 消费 | ✅ |
| 引擎级内容缓存、按文件增量 | ❌ | ✅ |
| 变更集计算（git diff） | ✅ | 接受变更文件列表 |

---

## 2. 现状基线（用事实说话）

| 项 | 当前事实 | 对升级的含义 |
| --- | --- | --- |
| 自有规则 | 注册表 36 条（27 JS + 9 engine）；引擎运行时常驻 6 条（5 taint + no-eval），arch/enforceExports 开启后 8 条，`no-import-cycle` 为图 pass | 规则面偏窄，Rust 安全规则尤其不足 |
| oxlint 规则 | `--rules` 实测 908 行输出 / 877 表格行 / 870 类别合计 / 807 唯一规则名 / 123 启用；900 是历史快照、不可复现 | 注册/启用/有效三口径差异巨大；文档不得用单一数字代表能力 |
| 默认启用 | `builtin-mapping.rules={}`；27 条 JS 规则（11 正确性 + 16 安全）默认全关；引擎可用且文件为 cache miss 时 6 条常驻规则（含 5 taint）仍运行；无 recommended/security 预设 | 新项目开箱只有内置 correctness + 6 条引擎规则，缺少框架/规则包默认启用 |
| 检测层 | L0 AST、L1 scope/symbol、L2 CFG 已具备；L3 过程内 taint；L4 调用图/跨文件缺失 | 深度是下一阶段主攻方向，不是再加语法规则 |
| Vue | 仅 `<script setup>` / `<script>` 虚拟块；template 不进入分析；`.vue` 上 `eslint/no-unused-vars` 默认整条抑制 | 目标仓 183 个 `.vue`，template 是 P0 缺口；抑制同时掩盖脚本内真实未使用变量 |
| 语言面 | `.ts/.tsx/.jsx/.js/.vue` 都在扫描扩展中；但 TSX/JSX **零 fixture、零专项规则** | 解析「能跑」不等于「有契约」；必须补 P0 用例 |
| 框架面 | Vue 仅 script；Express/Koa/Hono 靠硬编码 `req.query` 等名字；Nest/Angular/React 无语义建模 | 框架建模需要 profile 抽象，不能继续散落在 taint 表里 |
| 缓存/增量 | 缓存键 = 引擎/配置/插件/文件内容，不含路径；干净文件不写缓存；图规则只接收 miss 文件 | 重复内容文件会诊断错配；热扫会漏报/陈旧；跨文件规则不可按文件缓存 |
| 语料库 | 6 个仓库、约 5600 文件、3453 条诊断；`no-unused-expressions` 978 + `no-unused-vars` 915 = 54.8%；引擎规则仅 14 条（0.41%） | 语料偏「lint 风格面」，不能当安全精度基准；无逐条标注 |
| 性能 | 引擎 8ms / 1.07 万行（≈1.34M LOC/s）；端到端 207ms / 1.07 万行（≈5.2 万 LOC/s） | 性能不是瓶颈；增量正确性与并发上限才是 |
| 契约 | 指纹、SARIF、exit 0/1/2、pathEvents 已具备；无 confidence/cweTags/`--fail-on`/engineStatus/toolVersion；SARIF 无 taxonomies/suppressions；无 inline ignore | 平台无法按置信度门禁、无法消费 CWE、无法逐行抑制 |
| 输出 | `--output` 写文件后仍 `console.log(formatted)`，stdout 不干净 | 平台同时读文件与 stdout 会重复；需明确输出通道 |
| 版本 | CLI `0.0.1`、根 `0.1.0-alpha.0`、引擎 `0.1.0`、SARIF driver `0.0.1` | 发布/缓存/平台对账混乱；需单一版本源 |
| 工程 | 无 `.github/`、无 `.gitlab-ci.yml`、无 changesets；`bun run test` 不含 cargo；无 fuzz/超时/大小上限；无 clippy/cargo fmt | 「门禁」目前是脚本，不是流水线 |

> 口径说明：`oxlint --rules` 实测 877 表格行 / 870 类别合计 / 807 唯一规则名 / 123 启用，是不同统计口径；README 的「865+」、升级计划此前的「900」都不应直接当检测能力。后续对外材料统一使用「注册/启用/有效」三分法。

### 2.1 目标项目事实（cleancode-sast-web）

技术栈：Vue 3.5 + Vite + TypeScript + Pinia + Vue Router + vue-i18n + Ant Design Vue + vxe-table + axios + UnoCSS + Socket.IO；445 文件 / 183 个 `.vue`。

- 初扫 1795 条，其中 1747 条为 `.vue` 的 `eslint/no-unused-vars` 系统性误报（template 引用不可见），占 98%。
- 误报治理后 38 条：真实/风格问题 28 条、设计内噪音 8 条、保守保留误报 2 条。
- 真实缺陷集中在：跨函数/跨文件的 Promise 生命周期（6 条 floating + 2 条 `new Promise` 永不 settle）、token 落 localStorage、注释占位空 catch。
- **结论：规则数量已不是主要瓶颈，框架语义（template）与跨文件分析才是。**

### 2.2 差距矩阵（引擎视角）

| 能力 | 现状 | 替代必需 | 优先级 |
| --- | --- | --- | --- |
| 引擎集成契约 | 自有 CLI/配置 | scanner 调用面：输入路径/排除、规则启停、并发、输出 schema/退出码 | P0 |
| Vue SFC 语义 | 仅 `<script>` 虚拟块 | template 引用、组件解析、`defineXxx` 宏、模板安全 | P0 |
| 前端安全规则面 | 通用 JS 规则为主 | Vue/axios/浏览器 API 专项规则包 | P0 |
| 规则覆盖 | 自有 36 条 + oxlint 内置 | 现有 JS/TS 引擎规则清单 → 覆盖矩阵（实现/映射/缺口/豁免） | P0 |
| 语言面契约 | `.tsx/.jsx` 可解析但零 fixture | TSX/JSX 解析、JSX sink、React/Vue JSX 用例 | P0 |
| 跨文件分析 | 过程内 taint | 调用图 + 跨文件 taint（API → store → 组件）、跨文件 bug path | P1 |
| type-aware | opt-in（tsgolint） | Pinia action/axios Promise 类型、误报消解、按需性能策略 | P1 |
| 增量扫描 | 内容哈希缓存（全量筛减） | 接受 scanner 变更文件集 + 反向依赖影响面 + 图规则一致性 | P1 |
| 性能与内存 | 万行 207ms / 引擎 1.34M LOC/s | 大仓单文件、内存上限、并发参数 | P1 |
| 交付形态 | 单文件二进制 | Windows/Linux/macOS 产物、scanner 侧可部署 | P0 |

---

## 3. 覆盖面：语言面 → 框架语义面 → 生态

### 3.1 语言/语法面（P0：必须是契约，不是「代码里写了」）

| 语言面 | 现状 | 升级要求 |
| --- | --- | --- |
| JS / TS（ESM + CJS） | ✅ 解析与规则可用 | 保持；补 CJS/ESM 混用与装饰器的语料用例 |
| TSX / JSX | 🟡 扫描扩展包含 `.tsx/.jsx`，oxc 可解析；但 0 fixture、0 JSX 专项规则 | **P0 补契约**：`.tsx/.jsx` 解析、JSX 属性 sink、React/Preact JSX 规则包；否则不能宣称支持 |
| 装饰器 | 🟡 oxc 可解析；NestJS legacy 装饰器未专项验证 | P1 随 Nest profile 补验证 |
| Vue SFC | 🟡 script 虚拟块；template 未分析 | P0，见 §3.2 |
| Angular 模板 | ❌ 未建模；仅 1 条 `no-unsafe-trust-bypass` 语法规则 | P2，需求门控 |
| 其他（Svelte/Nuxt/Remix） | ❌ | P3，暂不投入 |

**结论**：TSX/JSX 必须进入 P0 语言面，但它是「语言/语法能力」，不等于 React 框架语义。两者要分开验收：前者是解析 + JSX AST 用例；后者是 hooks / server components / JSX sink 规则包。

### 3.2 框架语义面：用 Profile 建模，不要硬编码名字

框架语义不是「多加几个 source/sink 名字」，而是一组可声明、可测试的契约。建议引入 **Framework Profile**：

```ts
interface FrameworkProfile {
  id: string                         // vue3 / express / nest / react / angular
  detect: { packageNames?: string[]; fileGlobs?: string[] }
  entrypoints?: EntrypointSpec[]     // 路由、控制器、装饰器、页面组件
  sources: TaintSpec[]               // req.query / ctx.request / props / ...
  sinks: TaintSpec[]                 // fs / db / shell / DOM / redirect / ...
  sanitizers: TaintSpec[]            // DOMPurify / path.basename / 参数化查询 / ...
  propagators?: TaintSpec[]
  template?: TemplateSpec            // Vue/Angular/JSX 模板 AST 与引用索引
  macros?: MacroSpec[]               // defineProps / defineEmits / defineModel
  rulePack?: string[]                // 该 profile 专属规则包
  confidencePolicy?: ConfidencePolicy
}
```

核心原则：

1. **引擎内核只认通用 taint/IR**；框架差异全部进 profile 注册表。
2. Profile 必须能声明：入口点、source/sink/sanitizer、模板 AST、宏、组件解析、规则包、置信度策略。
3. 每个 profile 必须有独立语料与误报门禁；没有真实项目验证的 profile 不进入默认启用集。

### 3.3 框架优先级（需求驱动，不做「全家桶」）

| Profile | 优先级 | 需要建模 | 理由 |
| --- | --- | --- | --- |
| Vue 3（SFC + template） | **P0** | template AST、变量/组件引用、`defineXxx` 宏、`v-html` / 动态 `:href` / `:src`、Pascal/kebab 组件归一 | 目标仓 183 个 `.vue`；template 是目前最大语义缺口 |
| Express / Koa / Hono | **P1** | 路由入口、`req/ctx` source、`res` sink、中间件 | 后端 JS 检测的基础面；当前靠名字表，误报/漏报都不可控 |
| NestJS | **P1** | 装饰器（Controller/Get/Post）、DI、Guard/Interceptor、DTO 校验、异常过滤器 | 公司后端主栈；与 Express 共享底层但入口/参数形态不同 |
| Prisma / TypeORM / Sequelize / Mongoose | **P1** | `$queryRawUnsafe` / `query` / `find` 等 sink、参数化查询 sanitizer | SQL/NoSQL 注入是安全规则的核心缺口 |
| React / Next.js | P2 | JSX sink、hooks、server components、`dangerouslySetInnerHTML` | 需求驱动；TSX 语法已具备，先不投入框架语义 |
| Angular | P2 | template AST、DomSanitizer、DI、RxJS、结构指令 | 需求驱动；成本高，且当前无目标仓；不要因为「企业常见」而提前做 |
| GraphQL | P2 | resolver 入口、query/mutation sink、深度/复杂度 | 需求驱动 |
| Svelte / Nuxt / Remix | P3 | 各自模板与入口 | 暂不排期 |

**直接回答三个问题：**

- **TSX/JSX 要不要算？** 要，语言面 P0；当前支持不完整（无 fixture），必须先补契约。React/Next 的框架语义另算，P2。
- **Angular 等框架要不要建模？** 要，但不是现在。Angular 需要 template AST、DomSanitizer、DI、RxJS 四件套；没有真实目标仓就不做，避免范围蔓延。放进 P2 需求门控。
- **后端框架要不要算？** 要，而且比 Angular 更优先。公司后端以 Nest/Express 为主，Nest/Express + ORM 应进 P1；否则 taint 的入口识别与 SQL sink 都只能靠猜。

### 3.4 现状解耦边界：现在是「分层」，还不是「可插拔」

必须区分「模块分层」与「框架可插拔」，否则会低估后续接 Angular/React 的成本。

| 已解耦 | 事实 |
| --- | --- |
| JS 轨道与解析器 | 规则走 ESLint 兼容 API，不 import parser AST；`rule-sdk` 统一 meta 校验 |
| Vue processor | 独立包 `@lintsight/vue-processor`，与 CLI 通过函数调用解耦 |
| 报告/诊断/配置 | formatter、diagnostic、config-bridge 均为独立包；sidecar 协议隔离 oxlint 与引擎 |
| 规则登记 | 注册表 + meta + CI 一致性校验，规则可独立测试 |

| 尚未解耦（加框架仍要改内核） | 代码事实 |
| --- | --- |
| 框架 source/sink 语义 | 写死在 `crates/lintsight-engine/src/rules.rs` 的每规则表中；`taint.rs` 还有 `REQUEST_SCOPE_NAMES` / `KNOWN_MODULES`，加 Nest/Angular 要改 Rust 并重编译 |
| 模板/非 JS 文件分发 | `pipeline.ts` 硬编码 `.vue` 过滤与 `virtualizeVue`；`config-bridge` 只校验 `processor` 字段但不做分发，没有通用 `Processor` 接口 |
| 框架规则包 | `rules-core/src/index.js` 静态 import 全部规则，构建成单一 `plugins/lintsight-rules/index.js`；`jsPlugins` 只有一个路径，不能直接投放外部框架包 |
| 框架能力协商 | 引擎输入只有 `files/arch/tsPaths`，没有 `profileId`、能力声明、版本协商 |
| 默认启用策略 | `builtin-mapping` 是全局单表，没有按框架 profile 分组的默认启用集 |

**结论**：现在的「解耦」是包级别与引擎级别的分层，不是「加一个框架只加一个插件」。如果不补扩展点，支持 Angular 会同时改 `pipeline.ts`、`config-bridge`、`engine-bridge`、`rules.rs`、`taint.rs`、`plugins` 聚合产物六处，本质仍是改内核。

要达到「以后支持更多框架、代码解耦」的目标，需要三个稳定接口：

1. **FrameworkProfile**：声明入口、source/sink/sanitizer、模板、宏、规则包、置信度策略；数据型 profile（Express/Nest/ORM）应可从 JSON 加载，不重编译。
2. **Processor / SemanticAdapter**：按文件类型分发模板解析与虚拟化（Vue、Angular、JSX），CLI 不再硬编码 `.vue`。
3. **RulePack 加载器**：支持多个 jsPlugins / 规则包路径与版本声明，框架规则包独立构建、独立启用，不塞进单一聚合产物。

实现上分两层：**数据驱动 profile**（表 + 配置，覆盖大多数后端框架）与**代码适配器**（模板 AST、装饰器、DI，覆盖 Vue/Angular/React）。后者无法完全数据化，但接口必须稳定；接口稳定后，加框架是加一个 profile 包，而不是改引擎。

> 反模式：为了「未来可能支持」提前设计全能插件系统。正确做法是先为 Vue + Nest 两个真实目标落地 profile 接口，用第二个框架验证抽象是否成立，再扩展 Angular/React。

---

## 4. 检测深度：L0-L4 现状与目标

| 层 | 能力 | 现状 | 差距 |
| --- | --- | --- | --- |
| L0 | AST / 解析 | ✅ oxc + oxlint | TSX/JSX 用例缺失 |
| L1 | scope / symbol / import 绑定 | ✅ oxc semantic | 框架入口/组件绑定未建模 |
| L2 | CFG + def-use | ✅ oxc cfg；taint worklist | 无路径可行性约束，无 strong update |
| L3 | 过程内 taint | 🟡 5 条规则；CFG worklist + SymbolId | source/sink 名字匹配、sanitizer 覆盖窄、无 kill |
| L4 | 过程间 / 跨文件 / 调用图 | ❌ | 无函数摘要、无参数/返回值传播、无跨包图 |
| Type-aware | tsgolint 类型事实 | 🟡 opt-in，默认关闭 | Promise/axios/Pinia 类型误报无法消解 |
| Framework | Vue/Nest/Angular | 🟡 Vue script；其余缺失 | 见 §3 |

### 4.1 深度路线（D0-D4）

| 阶段 | 目标深度 | 典型能力 | 归属 |
| --- | --- | --- | --- |
| D0 | 语法 | AST 模式、字面量、危险 API | 已具备 |
| D1 | 局部语义 | 作用域、绑定、同文件声明 | 已具备 |
| D2 | 过程内流 | CFG taint、sanitizer、证据链 | 已具备（5 条规则） |
| D3 | 过程间 | 同文件/同包函数摘要、参数/返回传播、调用图 | **M5 主攻** |
| D4 | 跨包 + 类型 | 跨包调用图、type-aware taint、框架入口图 | M6 |

**判断**：当前处于 D2，且 D2 也只覆盖少数 sink 家族。企业级 SAST 的门槛至少是 D3；没有 D3，规则数量再多也只是「语法扫描器 + 少量 taint」。

### 4.2 D3 需要的最小能力集

1. **函数摘要**：参数是否污染、返回值是否污染、是否调用 sink、是否清洗。
2. **调用图**：直接调用 + import 绑定解析；动态分发显式标记 unresolved。
3. **参数/返回传播**：`function getQuery(req) { return req.query.q }` → `readFile(getQuery(req))` 可达。
4. **Strong update / kill**：`x = sanitize(x)` 后污染集移除，避免原地清洗误报。
5. **Sanitizer 注册表**：`path.basename`、`DOMPurify`、参数化查询、`encodeURIComponent`、allowlist 校验。
6. **框架入口**：Express/Nest 路由参数、Vue props/emits、组件边界。

---

## 5. 规则面：数量、结构与 Rust 安全规则

### 5.1 当前盘点

| 轨道 | 数量 | 构成 | 判断 |
| --- | --- | --- | --- |
| JS 轨道（`lintsight/*`） | 27 | 11 正确性 + 16 安全，以语法/局部启发为主 | 作为 P0 语法面合格；框架规则几乎空白 |
| Rust 引擎（`lintsight-engine/*`） | 9 | 5 taint + 1 语法（no-eval）+ 3 治理 | **安全规则明显偏少**，且 taint 仅过程内 |
| oxlint 内置 | 877 表格行 / 870 类别合计 / 807 唯一 / 123 启用 | 默认只开 correctness | 安全类多数未启用；不能把注册数当能力 |

### 5.2 「规则是不是太少了？」——是，但不要用数量解决

- 对**企业级替代**而言，36 条自有规则远远不够；尤其 Rust 轨道只有 5 条 taint，无法覆盖 OWASP/CWE 的主要注入家族。
- 但「加到 200 条语法规则」不会提升 SAST 价值，只会增加维护与误报。正确的 KPI 是**覆盖矩阵 100% 有结论** + **高危 CWE 家族的精确召回**。
- 建议目标：M5 时自有规则 45~55 条（JS 30~35 + 引擎 15~20），其中 Rust 安全规则 15~20 条（10~12 条 taint）；不以数量对外宣传。

### 5.3 Rust 引擎安全规则扩充建议

| 候选规则 | CWE | 检测层 | 阶段 | 说明 |
| --- | --- | --- | --- | --- |
| `no-sql-injection` | 89 | taint | M5 | 覆盖 `db.query` / `execute` / `$queryRawUnsafe` / `sequelize.query`；参数化查询为 sanitizer |
| `no-nosql-injection` | 943 | taint | M5 | Mongo/Mongoose 操作符注入、`$where`、对象注入 |
| `no-xss-dom-sink` | 79 | taint | M5 | `innerHTML` / `outerHTML` / `document.write` / `insertAdjacentHTML` / jQuery `.html` |
| `no-xss-framework-sink` | 79 | profile | M4/M5 | Vue `v-html`、React `dangerouslySetInnerHTML`、Angular `bypassSecurityTrust*` |
| `no-ssti` | 1336 | taint | M5 | ejs/pug/handlebars 模板编译拼接用户输入 |
| `no-xxe` | 611 | taint | M5 | XML 解析器开启外部实体 |
| `no-unsafe-deserialization` | 502 | taint/syntax | M5 | `node-serialize`、`unserialize`、YAML `load` 等 |
| `no-zip-slip` | 22 | taint | M5 | 解压条目路径直接落盘 |
| `no-header-injection` | 113 | taint | M5 | `setHeader` / `res.header` 拼接用户输入 |
| `no-log-injection` | 117 | taint | P2 | 日志拼接未编码用户输入；优先级低于注入类 |
| `no-jwt-misuse` | 347/798 | syntax/local | M5 | `jwt.decode` 代替 verify、`none` 算法、硬编码 secret |
| `no-command-injection`（扩展） | 78 | taint | M4 | 补 `execFile`、`spawn` 的 `shell:true` 语义与参数数组 sanitizer |
| `no-path-traversal`（扩展） | 22 | taint | M5 | allowlist / `path.resolve` 校验建模，减少 `basename` 单 sanitizer 误报 |
| `no-ssrf`（扩展） | 918 | taint | M5 | host allowlist 作为 sanitizer；区分固定 host 与用户可控 URL |
| `no-prototype-pollution`（扩展） | 1321 | taint | M5 | 覆盖 `Object.assign` / lodash merge / `set` 的 target 语义 |
| `no-open-redirect`（扩展） | 601 | taint | M5 | 精确 `===` allowlist 控制流识别，降低「任何可变量都报」 |

**实现原则**：继续表驱动（source/sink/sanitizer/propagator），每条规则 = 表 + 消息 + 框架 profile + fixture + 语料门禁；避免为每条规则复制一套分析器。这样扩 10 条 taint 的成本主要是表与用例，而不是引擎重写。

### 5.4 JS 轨道扩充建议

- **Vue 规则包**：`v-html`、动态 `:href`/`:src`（`javascript:` / `data:`）、`postMessage` 源校验、token 落 localStorage/日志。
- **React/JSX 规则包（P2）**：`dangerouslySetInnerHTML`、`href="javascript:"`、未校验的 `target="_blank"`（低价值，谨慎）。
- **后端语义规则（P1）**：Express/Nest cookie 选项、CORS、JWT、ORM 原始查询入口。
- **内置映射清单补开**：P0 提案里的 `eslint/no-new-func`、`eslint/no-unsafe-finally`、`eslint/no-fallthrough`、`react/no-danger`、`promise/catch-or-return`、`unicorn/no-document-cookie` 等目前仍未在 `builtin-mapping.rules` 落地（当前为 `{}`），应按评审结论逐条启用或明确豁免。

### 5.5 规则质量门禁（与 rule-authoring 对齐）

1. 每条规则 ≥3 bad / ≥2 good / safe case / 边界矩阵。
2. `meta.docs.falsePositives` 必填；security 必须带 CWE/OWASP tag。
3. 新规则必须过语料库误报门禁（correctness <5%、security <10%，或给出豁免评审记录）。
4. confidence 必须有依据；CI 默认只拦 `error + high`。
5. 规则 ID、messageId、指纹稳定性纳入注册表测试；文案变更视为 breaking。

---

## 6. 评估方法：从「锚点召回」升级为「逐行基准」

### 6.1 当前口径的问题

- juice-shop v0.3 的 65.4% 是 **17/26**，不是 17/111；85 个挑战被归为「无静态锚点」后移出分母。
- 判定是「锚点区域内任意自有规则命中」，例如 `localXss` 同时记了 `no-floating-promise` 与 `no-unsafe-trust-bypass`；前者与 XSS 无关，会虚高召回。
- cleancode-sast-web 的 38 条中，28 条真实/风格、8 条设计噪音、2 条保守误报；按「有效信号」口径约 74%，不是 95%+。
- 语料库 3453 条诊断中，`no-unused-expressions`（978）+ `no-unused-vars`（915）占 54.8%；引擎规则仅 14 条（0.41%）。这是「lint 风格面」，不能当安全精度基准。
- 语料库没有逐条标注、没有负样本集，只有「双报率 0」与「指纹漂移」门禁。

**结论**：当前数据适合做方向性 sanity check，不适合作为对外验收或「替代现有引擎」的证据。

### 6.2 建议的基准体系

| 项 | 方案 |
| --- | --- |
| 漏洞样本 | 30~50 个带**精确漏洞行**的样本（juice-shop / nodegoat / 自建 Vue+Express 靶场），官方 writeup 的 `vuln-line` 为锚点 |
| 负样本 | 10 个真实干净仓库（含框架、ORM、测试目录），用于统计误报 |
| 指标 | 每规则 TP / FP / FN、precision / recall / FP rate；confidence 校准（high/medium/low 分层） |
| 差分 | 与 Semgrep、`eslint-plugin-security` 同语料对比；CodeQL 视 license 条件 |
| 回归 | 指纹级基线 diff + 双报率 0 + 冷/热扫等价 + 规则间交叉验证 |
| 报告 | 每次发版生成 `docs/spikes/benchmark-vX.md`，数据来自脚本，不手写 |

### 6.3 验收线（建议）

- correctness 误报率 <5%；security 误报率 <10%（沿用 FR-202/302）。
- 每条 security 规则至少 20 个正样本、50 个负样本；样本不足不得进默认启用集。
- 召回不低于现有引擎基线；juice-shop 报告只作内部参考，不作为对外数字。
- 双跑一致率 ≥95%；冷/热扫诊断集合必须完全一致。

---

## 7. 关键工程缺口与修复（评估结论落地）

| ID | 优先级 | 缺口 | 证据 | 修复与验收 |
| --- | --- | --- | --- | --- |
| G1 | P0 | 增量缓存对跨文件规则不成立，且同内容文件会错配 | `createCacheKey` 只含引擎/配置/插件/内容，不含路径；干净文件因无 `group` 不写缓存；图规则只接收 `misses` | 键含路径 + tsconfig + engine/config/plugin 指纹；空结果也缓存；**引擎结果不缓存、每轮按当前文件集全量 pass**（依赖闭包/影响集/文件集由此覆盖，不进缓存键）；补「重复内容 / 断环 / 加文件 / tsconfig 变更」冷热等价测试 |
| G2 | P0 | 契约缺 confidence/cweTags/fail-on/engineStatus/toolVersion，且无 inline suppression | `LintsightDiagnostic` 只有 severity；`cli.ts` 无 `--fail-on`；`degraded` 不进报告；SARIF 无 taxonomies/suppressions；`--output` 仍写 stdout | 契约 v3；SARIF 补 taxonomies/suppressions；inline ignore + reason；golden/SARIF/scanner 消费测试 |
| G3 | P0 | 仓库无 CI；bench/corpus 基线陈旧 | 无 `.github/`、`.gitlab-ci.yml`；`bun run test` 不含 cargo；bench baseline 停在 `5136929` | GitHub Actions：bun + cargo + lint + format + clippy + bench + corpus + `check:change-id`；基线按版本重建 |
| G4 | P1 | Rust 轨道未真正兑现铁律 #2 | `rules.rs`/`taint.rs` 直接 `use oxc_ast`；`FileContext::semantic()` 返回 oxc `Semantic` | 补薄 `ir` façade，或明确修订铁律为「JS 强约束、Rust 绑定 oxc」 |
| G5 | P1 | 并发/资源无上限，无 fuzz | 无单文件超时/大小上限；分批 `Promise.all` 无上限；oxlint 自带多线程；rayon 全核；无 `--concurrency` | 文件级超时/大小/内存上限；`--concurrency` 贯通；parser/processor fuzz |
| G6 | P0 | fail-open 不可观测 | 引擎缺失返回 `degraded=false` 且无告警，与 design-m2 M2-DR3 的 `degraded:true` 冲突 | 报告加 `engineStatus`；缺失/崩溃/超时都标注；CI 可选 fail-closed |
| G7 | P1 | 文档/规则账目漂移 | README「865+」「140+46」；计划此前「900」；实际 877 表格行 / 870 类别合计 / 807 唯一 / 123 启用 | 统一 registered / enabled / effective；测试数与规则数由脚本生成 |
| G8 | P0 | Vue 误报治理靠整条抑制 | `.vue` 默认关闭 `no-unused-vars`；显式开启回到系统性误报 | template 引用索引恢复规则；抑制仅过渡；183 `.vue` 复扫验收 |
| G9 | P0 | TSX/JSX 无契约 | 0 个 `.tsx/.jsx` fixture、0 条 JSX sink 规则 | 补解析、JSX 属性 sink、React/Vue JSX 用例 |
| G10 | P2 | Vue fixture 仅 1 个 | fixtures 中仅 `no-empty-catch.vue` | 增加 SFC 多场景 fixture（script setup、template、宏、样式） |
| G11 | P2 | 发布/供应链无自动化 | 无 changesets/release；`oxlint-tsgolint: "7"` 浮大版本；无 cargo-deny/SBOM/签名/校验和 | changesets + 多平台产物 + 校验和 + 依赖审计；clippy/cargo fmt 入 CI |
| G12 | P0 | 27 条 JS 规则（11 正确性 + 16 安全）默认全关、无推荐集 | `builtin-mapping.rules={}`；空配置项目 JS 0 启用；引擎可用且文件为 cache miss 时 6 条常驻规则仍运行；1b 映射未落地 | 新增 `recommended` / `security` 预设；补齐 1b 清单；空配置坏样本能出安全诊断 |
| G13 | P0 | 配置/路径契约不适配 scanner | 配置按 cwd 解析、无 `--root`；外部绝对路径报告为绝对路径 | 明确 `--root`/cwd 语义；外部目标用其自身配置且报告相对路径 |
| G14 | P0 | 版本号三处不一致 | CLI `0.0.1`、根 `0.1.0-alpha.0`、引擎 `0.1.0`、SARIF driver `0.0.1` | 单一版本源；`--version`/SARIF/包版本发布检查 |
| G15 | P0 | Vue 虚拟路径进入图身份 | 引擎收到 `Foo.vue.lintsight-<pid>.ts`，指向 `Foo.vue` 的 import 与虚拟节点不同键；当前 bug 基线 Vue→TS 环 0 条，同结构 TS→TS 对照 2 条（`src/A.ts:1`、`src/B.ts:1`） | 修复目标 Vue→TS 环 2 条（`src/A.vue:1`、`src/B.ts:1`）；图节点映射回原 `.vue`；把 TS→TS 对照写成回归用例 |
| G16 | P2 | 输入面细节与文档不符 | arch `*` 仅前缀*后缀单星；默认忽略任意 `build/out` 段；重复输入未去重，已复现 `src src` → 引擎 `no-eval`/`no-path-traversal` 各 ×2（eslint 侧 1 条） | 文档标注或换 globset；忽略可配置+告警；输入 Set 去重，并加「重复 `src src` → 引擎诊断 ×2」回归测试 |
| G17 | P2 | opt-in 规则无对账 | engine-bridge 排除 arch/cycle/deep-import；summary 不含 `no-import-cycle` | 对账覆盖可配置面或版本/能力协商；陈旧二进制可告警 |

> M4 仅 P0：G5/G10 移至 M5；G6/G8/G9/G14/G15 为 M4 收口门槛，已升 P0。M4 = G1/G2/G3/G6/G8/G9/G12/G13/G14/G15。

---

## 8. 路线图（整合评估后的 M4 / M5 / M6）

### M4（P0）— 可集成 + 前端语义 + 评估闭环

**工作流**

1. **引擎集成契约**
   - 输入：扫描根、`--root`/cwd、包含/排除、变更文件列表（可选）、规则启停、并发上限。
   - 输出：诊断 JSON schema v3（指纹 + 证据链 + confidence + cweTags + engineStatus）、SARIF、exit 0/1/2；`--output` 与 stdout 二选一。
   - 分发：多平台二进制、单一版本源、`OXLINT_BIN` / `OXLINT_ENGINE_BIN` 约定。
2. **Vue 模板语义 v1**
   - 模板引用索引：变量、组件、指令、事件绑定；恢复 `no-unused-vars`。
   - 组件名归一（Pascal/kebab、按需导入/自动导入）。
   - `<script setup>` 宏：`defineProps` / `defineEmits` / `defineExpose` / `defineModel`。
   - 模板安全规则：`v-html`、动态 `:href`/`:src`、`window.open`、`postMessage` 源校验。
   - 图身份：Vue 虚拟路径映射回原 `.vue`，保证 importCycles 不因虚拟文件名漏环。
3. **框架 Profile v0 + 前端安全规则包 v1 + 默认预设**
   - 落地 `FrameworkProfile` 契约与注册表。
   - Vue 3 profile + Express/Koa/Hono profile（Nest basic）。
   - 把现有 taint 表中的 `req.query` 等硬编码迁移到 profile。
   - 前端安全规则包 v1（候选，需 P0 评审）：浏览器存储敏感数据、token 写日志/错误上报、`v-html`、开放重定向、动态 URL/SSRF、弱加密、`eval` / `new Function`。
   - 新增 `recommended` / `security` 预设，并补齐 1b 内置映射清单。
4. **规则覆盖矩阵**
   - 获取现有 JS/TS 引擎规则清单与样例诊断（平台团队提供）。
   - 输出实现 / 可映射 / 缺口 / 豁免四类结论；规则 ID 映射表由平台维护。
5. **双跑对照**
   - scanner 同仓库/commit 双跑；lintsight 保证确定性；差异逐条归因。
6. **工程正确性**
   - 修 G1（缓存路径/空结果/图规则/冷热等价）、G2（契约 v3 + inline suppression）、G3（CI）、G6（fail-open 可观测）、G9（TSX/JSX）、G12（默认预设）、G13（配置根）、G14（版本源）、G15（Vue 图身份）。
7. **基准 v1**
   - 30~50 个精确漏洞行样本 + 负样本；差分 Semgrep/ESLint；生成报告。

**M4 明确不做**：Angular/React 深度建模、跨文件 taint、20 条全新规则（现有 taint 规则的语义扩展除外）、远端缓存、LSP。

**M4 验收**

| 项 | 验收 |
| --- | --- |
| scanner 集成 | 可无改造消费 JSON/SARIF 与退出码；配置根与路径可显式传入 |
| Vue template | 183 个 `.vue` 目标仓复扫：template 引用不再系统性误报，`v-html` 等 sink 命中；Vue→TS 环回归用例 0 条、TS→TS 对照 2 条 |
| 默认预设 | 空配置项目扫描已知坏样本能出安全诊断；27 条 JS 规则（11 正确性 + 16 安全）不再默认全关 |
| 覆盖矩阵 | 现有引擎规则 100% 有结论，缺口有评审记录 |
| 双跑 | 对齐率 ≥95%，差异逐条归因 |
| 确定性 | 同一 commit 冷/热扫诊断集合完全一致；重复内容文件、断环、tsconfig 变更、重复输入均等价 |
| 契约 | confidence/cweTags/fail-on/engineStatus/toolVersion/inline suppression 齐全；`--output` 不污染 stdout |
| 质量 | correctness <5%、security <10% 的独立标注样本 |

#### M4 契约 v3（G2 实现约定）

- **JSON 报告**：`contractVersion` / `toolVersion` / `engineStatus` / `files` / `summary{error,warning,info,suppressed}` / `diagnostics`。
- **逐 finding 字段**：`confidence`（high|medium|low；finding 覆盖 → registry 默认 → medium 兜底）、`cweTags`（registry 登记）、`suppression?`（仅行内抑制，含 `kind/justification/directiveLine`）。
- **engineStatus**：`ok | degraded | missing | crashed | timeout`；`timeout` 的状态映射在 G2 定义，真实超时信号由 G6/G5 接线。
- **行内抑制**：`// lintsight-ignore-next-line <ruleId>: <reason>`；reason 必填；仅下一行生效；被抑制诊断保留在 `diagnostics` 并带 `suppression`，但不计入 summary / exit / `--fail-on`。
- **exit**：`--fail-on high|medium|low`（默认 `low` = 现有「任何 error 即 1」）；仅未抑制的 `severity=error` 且 `confidence` 不低于阈值时 exit 1；运行错误仍 exit 2。
- **SARIF**：`run.taxonomies`（CWE）+ `results[].taxa`、`results[].properties.confidence`、`results[].suppressions`、`driver.version = toolVersion`；ruleId/位置/指纹不变。
- **输出通道**：有 `--output` 时 stdout 必须为空（报告只落文件）。

### M5（P1）— 深度与规模化

1. **D3 跨文件 taint / 调用图**：函数摘要、参数/返回传播、同包调用图；跨文件 `pathEvents`。
2. **Rust 安全规则扩充**：按 §5.3 实施 10~12 条 taint + 2~3 条语法/配置规则。
3. **框架 Profile 扩展**：NestJS 完整语义、Prisma/TypeORM/Sequelize/Mongoose、GraphQL。
4. **type-aware 策略化**：Pinia action、axios 返回、composable 按需开启；默认关闭但可配置。
5. **增量与缓存**：接受 scanner 变更文件集；反向依赖影响面；图规则一致性。
6. **性能与内存（G5）**：`--concurrency`、超大文件、内存上限。
7. **工程支撑（G4/G7/G10/G16）**：Rust IR façade、文档/规则账目、Vue fixture、输入面与重复输入。
8. **基准扩展**：每规则 TP/FP/FN；季度误报复盘。

**M5 验收**：10 万行全量 <60s / 增量 <5s；Rust 安全规则 15~20 条；跨文件 taint 至少 2 条硬门槛规则误报 <15%；双跑 ≥95%。

### M6（P2）— 生态与框架扩展

- Angular profile（template AST、DomSanitizer、DI、RxJS）——**需求门控**，无目标仓不启动。
- React/Next profile（JSX sink、hooks、server components）。
- Svelte/Nuxt/Remix（按需）。
- LSP alpha + VS Code、`lintsight migrate` 完整版。
- G11 发布/供应链（changesets、多平台产物、校验和、SBOM、签名）。
- G17 opt-in 规则对账。
- fixer 高级策略、上游 oxc 跟进。
- 常驻 worker/daemon 归 scanner/平台，不在引擎排期。

---

## 9. 验收指标（汇总）

| 维度 | 指标 |
| --- | --- |
| 规则账目 | 注册/启用/有效三口径并列；现有 JS/TS 规则清单 100% 有结论（实现/映射/缺口/豁免） |
| 默认预设 | 空配置项目扫描已知坏样本能出安全诊断；有 `recommended` / `security` 两档 |
| 检测深度 | M4 达 D2 + Vue template；M5 达 D3（同包过程间/跨文件）；M6 达 D4 |
| 双跑一致性 | 同 commit 诊断（文件+行+规则映射）对齐率 ≥95%，差异逐条归因 |
| 误报率 | 真实前端仓库 correctness <5%、security <10%；每条 security 规则至少 20 正 / 50 负样本 |
| 召回 | 精确行标注基准不低于现有引擎基线；juice-shop 仅作内部参考 |
| 性能 | 445 文件全量冷扫 <10s；百文件增量 <1s；10 万行 <60s；引擎 ≥15 万 LOC/s；并发有上限 |
| 确定性 | 冷/热扫诊断集合一致（覆盖重复内容、断环、tsconfig 变更、重复输入）；指纹跨 commit 稳定 |
| 契约 | JSON/SARIF 含 confidence/cweTags/pathEvents/engineStatus/toolVersion/inline suppression；scanner 可直接消费 |
| 配置/路径 | 外部目标用其自身配置；`--root`/cwd 语义明确；报告路径相对可映射 |
| 版本 | `--version`、SARIF driver、包版本、引擎版本单一来源且一致 |
| 工程 | CI 全绿（bun + cargo + clippy + cargo fmt + lint + format + bench + corpus）；发布可追溯 |

---

## 10. 风险与开放问题

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 现有 JS/TS 引擎规则清单不可见 | 覆盖矩阵无法闭合，替代验收无依据 | M4 启动前由平台提供规则目录、样例诊断、误报口径 |
| scanner 调用契约未文档化 | 集成返工 | 先冻结 JSON schema v3、`--root`/cwd 与 exit 语义，再做双跑 |
| 框架 profile 范围蔓延 | 每个框架都像新项目 | 需求门控 + 目标栈优先（Vue → Nest/Express → ORM → React/Angular） |
| Angular 需求不确定 | 投入大、回报未知 | 等真实目标仓；先做 profile 架构，不提前实现 |
| taint 误报 | 团队弃用 | 置信度分级、CI 只拦 high、inline suppression、语料门禁、独立标注基准 |
| 增量缓存不一致 | 热扫漏报/陈旧误报/诊断错配 | G1 修复：键含路径 + tsconfig + 依赖集；空结果缓存；图规则全量或不可缓存；冷/热扫等价纳入 CI |
| 27 条 JS 规则（11 正确性 + 16 安全）默认全关 | 开箱安全面远低于预期，用户需手抄 27 条 | G12：recommended/security 预设 + 1b 映射（引擎可用且文件为 cache miss 时 6 条常驻规则仍运行） |
| 配置/路径不适配 scanner | 目标项目配置被忽略、报告路径不可映射 | G13：`--root`/cwd 契约与外部目标测试 |
| 版本号漂移 | 发布、缓存、平台对账混乱 | G14：单一版本源 + 发布检查 |
| 并发/资源失控 | 大仓线程爆炸、OOM、挂死 | G5：文件级超时/大小/内存上限、`--concurrency` 贯通、fuzz |
| 规则数量虚荣 | 维护成本上升、质量下降 | 以覆盖矩阵和 TP/FP 为 KPI，不以规则数对外宣传 |
| CI 无人维护 | 门禁形同虚设 | 指定 owner；流水线失败即阻断合并 |
| 二进制/离线分发 | 扫描节点部署失败 | 多平台产物 + 校验和 + 内网镜像；oxlint 伴生供给文档化 |
| Bun / oxlint alpha | 上游行为漂移 | 版本锁定 + 语料 diff + 升级评审 |

---

## 附录 A：原 `docs/todo.md` 未完成项处置

原 `docs/todo.md` 已并入本计划并删除；未完成项处置如下：

| 原条目 | 原编号 | 归属 | 处置 |
| --- | --- | --- | --- |
| 迁移工具 v0（eslint.config → lintsight.config 映射报告） | M2.7 / FR-502 | 引擎（M6） | 作为引擎附带 CLI 工具 |
| 引擎 `--concurrency` 参数 | T2.6 备案 | 引擎（M5） | 与 scanner 传入并发上限对齐 |
| type-aware taint 增强（类型事实消解误报、业务 source/sink） | 远期 | 引擎（M5） | 并入 M5 第 4 项 |
| LSP alpha + VS Code | 远期 | 引擎（M6） | 开发者体验，不阻塞替代 |
| fixer 高级策略（dangerous / 收敛防护） | 远期 | 引擎（M6） | 保留 |
| oxc#27280 上游跟进 | 远期 | 引擎（M6） | 外部依赖，跟踪 |
| 平台对接协议评审（指纹/抑制同步/AI 研判字段） | M2.7 | scanner / 平台 | 移出引擎范围 |
| GitHub Code Scanning / GitLab SAST 上传实测 | T3.1 | scanner / CI | 移出引擎范围 |
| 远端缓存 + 分布式分片 | 远期 | scanner / 平台 | 移出引擎范围 |
| 平台化闭环（长驻 worker、抑制同步、AI 对接） | 远期 | scanner / 平台 | 移出引擎范围 |
| 多语言 IR 中立化 / WASM / 插件市场 | 远期 | 非 JS/TS 引擎 | 移出本仓范围 |

---

## 附录 B：框架 Profile 字段建议

| 字段 | 作用 | 示例 |
| --- | --- | --- |
| `detect` | 判断项目是否启用该 profile | `packageNames: ["vue"]` / `fileGlobs: ["**/*.vue"]` |
| `entrypoints` | 识别外部输入入口 | Express 路由、Nest Controller、Vue 组件 props |
| `sources` | 污点源 | `req.query`、`ctx.request.body`、`defineProps` |
| `sinks` | 污点汇聚 | `fs.readFile`、`db.query`、`res.redirect`、`v-html` |
| `sanitizers` | 清洗函数 | `path.basename`、`DOMPurify.sanitize`、参数化查询 |
| `template` | 模板 AST 与引用索引 | Vue/Angular/JSX |
| `macros` | 框架宏 | `defineProps`、`defineEmits`、`defineModel` |
| `rulePack` | 专属规则 | Vue 安全包、Nest 安全包 |
| `confidencePolicy` | 框架相关置信度调整 | 模板变量命中降级/升级 |

---

## 修订记录

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| v0.1 | 2026-10-29 | 首版草案：基于 cleancode-sast-web 扫描事实推断 |
| v0.1 修订 1 | 2026-10-29 | 按组件边界做减法：明确 lintsight 仅为 JS/TS 引擎；移除平台 CLI 协议、报告/缺陷上传、任务生命周期、基线/抑制、策略中心、AI 研判调度、CI/CD 等 scanner 职责 |
| v0.1 修订 2 | 2026-10-29 | 并入原 `docs/todo.md` 未完成项（附录 A）；补充 `--concurrency`、type-aware taint、fixer 高级策略与上游跟进；原 todo 删除 |
| v0.1 修订 3 | 2026-10-29 | 合并 M1-M3 交付评估：新增评分与结论、语言/框架覆盖面模型（TSX/JSX、Vue、Angular、Nest/Express/ORM）、L0-L4 深度路线、Rust 安全规则扩充清单、精确行基准与验收口径、工程缺口 G1-G11；明确 Angular/React 需求门控与「覆盖矩阵优先于规则数量」 |
| v0.1 修订 4 | 2026-10-29 | 复核独立评审 v0.1：采纳 B1/B2 + B3（H3 升级）、H1/H2/H4-H9、M1-M9（M9 已复现）与 L1-L4；评分改为 MVP 6.0 / 企业替代 3.3；补 G12-G17（默认预设、配置根、版本源、Vue 图身份、输入面、opt-in 对账）；修正 7 处口径（processor 语义、注册数、空配置安全面、engine degraded 设计冲突、M9 已复现、SQL 表述、评分非事实）；M4 验收增加冷/热等价、默认预设、契约字段与路径/版本一致性 |
| v0.1 修订 5 | 2026-10-29 | 按执行清单复核调整范围：M4 仅 P0；G6/G8/G9/G14/G15 升 P0；G5/G10 移至 M5；G4/G7/G16 归 M5，G11/G17 归 M6；补 G15 修复目标（Vue→TS 2 条，当前 0 条为 bug 基线）；执行清单补齐证据行、G1 8 组缓存矩阵、G2 schema 细节、G12 规则账、G13 优先级、G3 分阶段 CI、G8/H5/前端包规则 ID 边界 |
| v0.1 修订 6 | 2026-10-30 | G1 收口口径对齐实现：缓存键 = 路径 + tsconfig + engine/config/plugin 指纹；**引擎诊断不缓存、每轮全量 pass**，文件集/依赖闭包/影响集不进键；空结果缓存；图规则矩阵由 `REQUIRE_ENGINE=1` 硬门禁防静默 skip |
| v0.1 修订 7 | 2026-10-30 | 补 M4 契约 v3 实现约定（G2）：报告/诊断字段、engineStatus 五态、行内抑制审计口径、`--fail-on` 语义、SARIF taxonomies/suppressions、`--output` stdout 静默；G6 仍独立负责 fail-closed 与超时接线 |
