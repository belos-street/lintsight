# lintsight M4 执行清单（execution-todo）

> 来源：[upgrade-plan.md](upgrade-plan.md)（v0.1 修订 4）；本文件只记录执行状态与验收，不重复决策。
> G-ID 以升级计划 §7 为准；大类工作项按里程碑与 workstream 分组，不按「架构 / SAST / 工程 / 框架」拆文件。
> 状态：`[ ]` 未开始 · `[~]` 进行中 · `[x]` 完成 · `[!]` 阻塞

## 0. 当前基线（2026-10-29）

- 评审基线：MVP **6.0 / 10**，企业级替代 **3.3 / 10**（独立评审 v0.1，±0.5）。
- 当前检测深度：L0/L1/L2 具备，L3 过程内 taint（5 条规则），L4 缺失。
- 当前规则面：27 条 JS + 9 条 engine；引擎常驻 6 条；27 条 JS 默认全关。
- 外部依赖（不解决则 M4 无法收口）：
  - 现有 JS/TS 引擎规则目录、样例诊断、误报口径（平台团队）。
  - scanner 调用契约：`--root`/cwd、变更集、并发、输出 schema、exit 语义。

## 1. M4（P0）— 可集成 + 前端语义 + 评估闭环

### W1 集成契约与可观测性

- [ ] **G2 契约 v3**
  - owner：engine + platform
  - 内容：诊断 JSON/SARIF 增加 confidence、cweTags、engineStatus、toolVersion；`--fail-on`；inline ignore + reason；`--output` 不污染 stdout。
  - 验收：golden/SARIF 快照更新；scanner 消费测试通过；缺引擎时报告可见 `engineStatus`。
  - 依赖：无。
- [ ] **G6 fail-open 可观测**
  - owner：engine
  - 内容：引擎缺失/崩溃/超时统一标注；CI 可选 fail-closed。
  - 验收：缺引擎、协议损坏、超时三种场景均有报告状态与退出码语义。
- [ ] **G13 配置根与路径契约**
  - owner：engine
  - 内容：新增 `--root` 或明确 cwd 语义；外部目标使用其自身配置；报告路径相对可映射。
  - 验收：扫描外部绝对路径项目，配置正确发现、报告路径不含 `C:/`/`/Users/` 绝对前缀。
- [ ] **G14 单一版本源**
  - owner：release
  - 内容：CLI、根包、引擎、SARIF driver 版本一致。
  - 验收：`--version` / SARIF / 包版本 / 引擎版本检查进 CI。

### W2 Vue 模板语义

- [ ] **G8 Vue template v1**
  - owner：vue + engine
  - 内容：模板引用索引、组件归一、`defineXxx` 宏、`v-html`/动态 `:href`/`:src` 规则。
  - 验收：183 个 `.vue` 目标仓复扫无系统性误报；`v-html` sink 命中；恢复 `no-unused-vars`。
- [ ] **G15 Vue 虚拟路径图身份**
  - owner：engine
  - 内容：虚拟路径映射回原 `.vue`；仅 `importCycles` 开启时生效。
  - 验收：Vue→TS 环 0 条；同结构 TS→TS 对照 2 条（`src/A.ts:1`、`src/B.ts:1`）写成回归用例。
- [ ] **G10 Vue fixture**
  - owner：QA
  - 内容：script setup、template、宏、样式多场景 fixture。
  - 验收：新增 fixture 进入 RuleTester/golden。

### W3 框架 Profile v0 + 默认预设

- [ ] **G12 默认 recommended/security 预设**
  - owner：config + rules
  - 内容：`recommended` / `security` 两档；补齐 1b 映射清单（`no-new-func`、`no-unsafe-finally`、`no-fallthrough`、`react/no-danger`、`promise/catch-or-return`、`unicorn/no-document-cookie` 等）。
  - 验收：空配置项目扫描已知坏样本能出安全诊断；预设测试锁定；27 条 JS 规则不再默认全关。
- [ ] **H5 FrameworkProfile v0**
  - owner：engine
  - 内容：Profile 注册表（入口、source/sink/sanitizer、模板、宏、规则包、置信度策略）；Vue 3 + Express/Koa/Hono（Nest basic）。
  - 验收：新增数据型 profile 不改 Rust；现有 taint 表硬编码迁移到 profile；模板适配器接口稳定。
- [ ] **前端安全规则包 v1**
  - owner：rules
  - 内容：浏览器存储敏感数据、token 写日志/错误上报、`v-html`、开放重定向、动态 URL/SSRF、弱加密、`eval`/`new Function`。
  - 验收：P0 规则提案评审通过；每条 ≥3 bad / ≥2 good；语料误报门禁通过。

### W4 覆盖矩阵与双跑

- [ ] **H4 规则覆盖矩阵**
  - owner：platform + engine
  - 内容：现有 JS/TS 引擎规则清单 → 实现/映射/缺口/豁免四类结论；规则 ID 映射表。
  - 验收：清单 100% 有结论，缺口有评审记录。
- [ ] **双跑对照**
  - owner：platform + QA
  - 内容：同仓库/commit 双跑；诊断（文件+行+规则映射）对齐率 ≥95%；差异逐条归因。
  - 验收：双跑报告落盘，差异有 owner 与结论。

### W5 工程正确性

- [ ] **G1 缓存正确性**
  - owner：engine
  - 内容：缓存键含路径 + tsconfig + 依赖闭包/影响集 + 文件集；空结果也缓存；图规则全量 pass 或标不可缓存。
  - 验收：重复内容、断环、加文件、tsconfig 变更四场景冷/热扫诊断集合一致。
- [ ] **G3 CI 与基线**
  - owner：CI
  - 内容：GitHub Actions：bun + cargo + clippy + cargo fmt + lint + format + bench + corpus；重建 bench/corpus 基线。
  - 验收：流水线红即阻断合并；基线按版本可追溯。
- [ ] **G5 资源与并发上限**
  - owner：engine
  - 内容：单文件超时/大小/内存上限；`--concurrency` 贯通；parser/processor fuzz。
  - 验收：超大文件降级、线程数有界、超时测试通过。
- [ ] **G9 TSX/JSX 契约**
  - owner：rules + QA
  - 内容：`.tsx/.jsx` fixture；JSX 属性 sink；React/Vue JSX 用例。
  - 验收：TSX 坏/好用例矩阵通过；`dangerouslySetInnerHTML`/`href={userInput}` 可命中。

### W6 基准 v1

- [ ] **精确行样本**
  - owner：QA
  - 内容：30~50 个带精确漏洞行的样本（juice-shop / nodegoat / 自建 Vue+Express 靶场）+ 10 个干净仓库。
  - 验收：每规则 TP/FP/FN 可统计；至少 20 正 / 50 负样本/security 规则。
- [ ] **差分与报告**
  - owner：QA
  - 内容：与 Semgrep、`eslint-plugin-security` 同语料对比；脚本生成 `benchmark-vX.md`。
  - 验收：security FP <10%、correctness FP <5%；召回不低于现有引擎基线。

## 2. M5（P1）— 深度与规模化

- [ ] **D3 跨文件 taint / 调用图**
  - 内容：函数摘要、参数/返回传播、同包调用图、跨文件 `pathEvents`。
  - 验收：至少 2 条硬门槛规则跨文件命中且误报 <15%。
- [ ] **Rust 安全规则扩充**
  - 内容：按升级计划 §5.3，10~12 条 taint + 2~3 条语法/配置规则。
  - 验收：Rust 安全规则 15~20 条；每条过 fixture + 语料门禁。
- [ ] **框架 Profile 扩展**
  - 内容：NestJS 完整语义、Prisma/TypeORM/Sequelize/Mongoose、GraphQL。
  - 验收：Nest/Express 目标仓可跑；ORM sink 有命中。
- [ ] **type-aware 策略化**
  - 内容：Pinia action、axios 返回、composable 按需开启；默认关闭可配置。
  - 验收：tsgolint 缺失自动降级；误报消解有数据。
- [ ] **增量与性能**
  - 内容：接受 scanner 变更集；反向依赖影响面；`--concurrency`；内存上限。
  - 验收：10 万行全量 <60s / 增量 <5s；1 万文件资源有界。
- [ ] **基准扩展**
  - 内容：每规则 TP/FP/FN；季度误报复盘。
  - 验收：基准趋势可追踪。

## 3. M6（P2）— 生态与框架扩展

- [ ] Angular profile（需求门控：无目标仓不启动）
- [ ] React/Next profile
- [ ] Svelte/Nuxt/Remix（按需）
- [ ] LSP alpha + VS Code
- [ ] 常驻 worker
- [ ] `lintsight migrate` 完整版
- [ ] fixer 高级策略、上游 oxc 跟进
- [ ] 多平台发布 + 校验和 + 签名 + SBOM

## 4. 明确不做（防范围蔓延）

- 不用 200 条语法规则冲数量。
- 不自建 TypeScript 类型检查器（继续用 tsgolint）。
- 不把任务/上传/基线 UI/AI 研判塞进引擎（scanner/平台职责）。
- 不在无目标仓时提前做 Angular/React。
- 不用规则级 confidence 常量冒充逐 finding 置信度。
- 不先做缓存性能优化而跳过正确性。
- 不用 LLM 自动修 taint。

## 5. 状态更新规则

- 每周更新一次状态；`[!]` 必须写阻塞原因与 owner。
- 完成项必须附验收证据（命令输出、测试名、报告路径）。
- 计划变更先改 [upgrade-plan.md](upgrade-plan.md)，再同步本清单；不反向修改决策。
- M4 收口前，P0 项不得以「后续补」关闭。
