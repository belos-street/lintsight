# lintsight M4 执行清单（execution-todo）

> 来源：[upgrade-plan.md](upgrade-plan.md)（v0.1 修订 5）；本文件只记录执行状态与验收，不重复决策。
> 范围：**M4 只做 P0**。G5/G10 移至 M5；G6/G8/G9/G14/G15 为 M4 收口门槛，已升 P0。
> G-ID 全量覆盖：M4 = G1/G2/G3/G6/G8/G9/G12/G13/G14/G15；M5 = G4/G5/G7/G10/G16；M6 = G11/G17。
> 状态：`[ ]` 未开始 · `[~]` 进行中 · `[x]` 完成 · `[!]` 阻塞
> 证据：每个 P0 项必须写“证据”行；完成项必须附命令/测试名/报告路径，不能只改状态。

## 0. 当前基线（2026-10-29）

- 评审基线：MVP **6.0 / 10**，企业级替代 **3.3 / 10**（独立评审 v0.1，±0.5）。
- 当前检测深度：L0/L1/L2 具备，L3 过程内 taint（5 条规则），L4 缺失。
- 当前规则面：27 条 JS + 9 条 engine；引擎常驻 6 条；27 条 JS 默认全关。
- 外部依赖（不解决则 M4 无法收口）：
  - **H4 覆盖矩阵 / 双跑对照**：依赖平台提供现有 JS/TS 引擎规则目录、样例诊断、误报口径；见 W4 的 `[!]`。
  - **scanner 调用契约**：`--root`/cwd、变更集、并发、输出 schema、exit 语义；G2 验收需要 scanner 签字。

## 1. M4（P0）— 可集成 + 前端语义 + 评估闭环

### W1 集成契约与可观测性

- [ ] **G2 契约 v3**
  - owner：engine + platform
  - 内容：
    - 诊断 JSON/SARIF 增加 `confidence`（**逐 finding**，规则 meta 只做默认值）、`cweTags`、`engineStatus`、`toolVersion`。
    - `engineStatus` 枚举：`ok | degraded | missing | crashed | timeout`。
    - inline ignore 语法：`// lintsight-ignore-next-line <ruleId>: <reason>`；reason 进入审计字段。
    - SARIF：`taxonomies` 放 CWE，`properties` 放 confidence，`suppressions` 放抑制。
    - `--fail-on` 支持 `high`；`--output` 时 stdout 必须为空。
  - 验收：golden/SARIF 快照更新；scanner 消费测试通过；缺引擎时报告可见 `engineStatus`。
  - 证据：`sarif.test.ts` + `report-v2.json` golden 更新；`engine-bridge.test.ts` 增加 engineStatus 五态；CLI 集成测试断言 `--output` 时 stdout 为空；scanner 签字确认。
  - 依赖：scanner 调用契约。
- [ ] **G6 fail-open 可观测**
  - owner：engine
  - 内容：引擎缺失/崩溃/协议损坏/超时统一标注；CI 可选 fail-closed。
  - 验收：四种失败场景均有 `engineStatus` 与退出码语义，不再静默。
  - 证据：`engine-bridge.test.ts` 增加 missing/crashed/timeout/protocol 四组；报告 golden 增加 `engineStatus`。
- [ ] **G13 配置根与路径契约**
  - owner：engine
  - 内容：明确优先级 **`--root` > `--config` > cwd**；config/ignore/tsconfig/报告路径全部 root 相对。
  - 验收：扫描外部绝对路径项目，配置正确发现、报告路径不含 `C:/`/`/Users/` 绝对前缀。
  - 证据：新增 `config-root.test.ts` 三组：外部绝对路径、嵌套 config、显式 `--config`；`ignore.test.ts` 回归。
- [ ] **G14 单一版本源**
  - owner：release
  - 内容：CLI、根包、引擎、SARIF driver 版本一致。
  - 验收：`--version` / SARIF / 包版本 / 引擎版本检查进 CI。
  - 证据：`version-check` CI 脚本 + `sarif.test.ts` 快照；发布检查清单。

### W2 Vue 模板语义

- [ ] **G8 Vue template v1**
  - owner：vue + engine
  - 内容：模板引用索引、组件归一、`defineXxx` 宏、模板 sink 规则。
  - **规则 ID 与归属（避免与 H5/前端包重复）**：
    - `lintsight/no-v-html`：Vue template sink，owner = rules-core/vue；
    - `lintsight/no-unsafe-template-url`：动态 `:href`/`:src`（`javascript:`/`data:`），owner = rules-core/vue；
    - 既有 `lintsight/no-innerhtml-assignment` 继续只做 script 侧，不重复模板 `v-html`；
    - H5 只拥有 TemplateAdapter/Profile，不拥有具体规则 ID；
    - 前端安全包 v1 不重复实现 `v-html`，只补 `no-postmessage-no-origin`、存储/日志等。
  - 验收：183 个 `.vue` 目标仓复扫无系统性误报；`v-html` sink 命中；恢复 `no-unused-vars`。
  - 证据：新增 `fixtures/vue/*.vue` 与 `vue-template.test.ts`；183 `.vue` 复扫报告（误报数、命中数）。
  - 依赖：H5 TemplateAdapter 接口。

- [ ] **G15 Vue 虚拟路径图身份**
  - owner：engine
  - 内容：虚拟路径映射回原 `.vue`；仅 `importCycles` 开启时生效。
  - **验收（注意方向）**：
    - 当前 bug 基线：Vue→TS 环 **0 条**；
    - 修复目标：Vue→TS 环 **2 条**（`src/A.vue:1`、`src/B.ts:1` 各 1 条），与同结构 TS→TS 对照 **2 条**一致；
    - 0 条是待修 bug，不能当验收通过。
  - 证据：`engine-bridge.test.ts` 新增 `Vue→TS` 回归用例；同结构 `TS→TS` 对照用例；断言两边均为 2 条。

### W3 框架 Profile v0 + 默认预设

- [ ] **G12 默认 recommended/security 预设**
  - owner：config + rules
  - 内容：
    - 规则账：27 条 JS = **11 正确性 + 16 安全**。
    - severity 策略：security 默认 error，low confidence 不进 `--fail-on high`。
    - `react/no-danger` 等 React 规则按 profile 门控，**不默认给 Vue 项目**。
    - 新增 registered/enabled/effective 计数脚本与快照测试。
  - 验收：空配置项目扫描已知坏样本能出安全诊断；预设测试锁定；27 条 JS 规则不再默认全关。
  - 证据：`builtin-mapping.test.ts` 预设快照；空配置坏样本扫描报告；计数脚本输出三口径。
- [ ] **H5 FrameworkProfile v0**
  - owner：engine
  - 内容：Profile 注册表（入口、source/sink/sanitizer、模板、宏、规则包、置信度策略）；Vue 3 + Express/Koa/Hono（Nest basic）。
  - 验收：新增数据型 profile 不改 Rust；现有 taint 表硬编码迁移到 profile；模板适配器接口稳定。
  - 证据：`profile-registry.test.ts`；新增一个数据型 profile 的零 Rust 改动演示；Express fixture。
- [ ] **前端安全规则包 v1**
  - owner：rules
  - 内容：浏览器存储敏感数据、token 写日志/错误上报、`no-postmessage-no-origin`、开放重定向、动态 URL/SSRF、弱加密、`eval`/`new Function`。
  - 验收：P0 规则提案评审通过；每条 ≥3 bad / ≥2 good；语料误报门禁通过；不重复 G8 的 `v-html`。
  - 证据：新增规则 fixtures + 注册表登记 + 语料 diff。

### W4 覆盖矩阵与双跑

- [!] **H4 规则覆盖矩阵（阻塞）**
  - owner：platform + engine
  - 阻塞原因：平台尚未提供现有 JS/TS 引擎规则目录、样例诊断、误报口径。
  - 内容：现有规则清单 → 实现/映射/缺口/豁免四类结论；规则 ID 映射表。
  - 验收：清单 100% 有结论，缺口有评审记录。
  - 证据：覆盖矩阵报告路径；平台负责人签字。
  - fallback：平台逾期则 M4 只能出“覆盖矩阵未闭合”的例外报告，**不能宣称替代验收通过**。
- [!] **双跑对照（阻塞）**
  - owner：platform + QA
  - 阻塞原因：依赖平台提供现有引擎可执行入口与同 commit 扫描能力。
  - 内容：同仓库/commit 双跑；诊断（文件+行+规则映射）对齐率 ≥95%；差异逐条归因。
  - 验收：双跑报告落盘，差异有 owner 与结论。
  - 证据：双跑报告路径 + 差异归因表 + 平台签字。
  - fallback：同 H4，只能出例外报告。

### W5 工程正确性

- [ ] **G1 缓存正确性**
  - owner：engine
  - 内容：缓存键含路径 + tsconfig + 依赖闭包/影响集 + 文件集；空结果也缓存；图规则全量 pass 或标不可缓存。
  - 验收测试矩阵（至少 8 组）：
    1. 同内容不同路径（当前 bug 的直接回归）；
    2. 干净文件命中（空结果缓存）；
    3. 文件删除后不命中旧条目；
    4. config/plugin/engine 版本变化击穿；
    5. `--no-cache` 与 cache 诊断集合一致；
    6. 同 key 并发写入原子性；
    7. 图规则（断环/加文件）冷热等价；
    8. tsconfig 变更冷热等价。
  - 证据：`cache.test.ts` 新增 8 组用例；冷/热扫报告 diff 为空。
- [ ] **G3 CI 与基线（分阶段）**
  - owner：CI
  - 内容：
    - 第一阶段最小 CI：`bun test` + `lint` + `format:check`；
    - 第二阶段：`cargo test` + `clippy` + `cargo fmt`；
    - 第三阶段：bench + corpus（专用 runner）；
    - 写明 OS 矩阵（Windows/Linux/macOS 至少 Linux+Windows）；
    - branch protection：CI 红即阻断合并。
  - 验收：流水线红即阻断合并；基线按版本可追溯。
  - 证据：`.github/workflows/ci.yml`；分支保护配置；一次成功/失败运行链接。
- [ ] **G9 TSX/JSX 契约（拆分）**
  - owner：rules + QA
  - 范围：
    - **TSX 语法 P0（M4）**：解析、JSX 属性 sink、Vue/React JSX 基础用例；
    - **React 框架语义 P2（M6）**：hooks/server components；React 规则不默认进 Vue 项目。
  - 验收：TSX 坏/好用例矩阵通过；`dangerouslySetInnerHTML`/`href={userInput}` 可命中。
  - 证据：`fixtures/tsx/*.tsx` + `fixtures/jsx/*.jsx`；`jsx-sink.test.ts`。

### W6 基准 v1

- [ ] **精确行样本**
  - owner：QA
  - 内容：30~50 个带精确漏洞行的样本（juice-shop / nodegoat / 自建 Vue+Express 靶场）+ 10 个干净仓库。
  - 验收：每规则 TP/FP/FN 可统计；至少 20 正 / 50 负样本/security 规则。
  - 证据：样本清单 + 标注文件路径。
- [ ] **差分与报告**
  - owner：QA
  - 内容：与 Semgrep、`eslint-plugin-security` 同语料对比；脚本生成 `benchmark-vX.md`。
  - 验收：security FP <10%、correctness FP <5%；召回不低于现有引擎基线。
  - 证据：`docs/spikes/benchmark-vX.md` + 生成脚本 + 差分报告。
- [ ] **SARIF 消费实测**
  - owner：platform + CI
  - 内容：GitHub Code Scanning / GitLab 制品上传实测。
  - 验收：至少一个平台可消费，ruleId/位置/fingerprint 正确。
  - 证据：上传记录/截图 + 平台侧结果。

## 2. 未纳入 M4 的 G 项（全量补齐）

| G-ID | 内容 | 优先级 | 归属 | 说明 |
| --- | --- | --- | --- | --- |
| G4 | Rust IR façade | P1 | M5 | 规则不再直接 `use oxc_ast`，或明确修订铁律 |
| G5 | 资源/并发上限 | P1 | M5 | 单文件超时/大小/内存上限、`--concurrency`、fuzz |
| G7 | 文档/规则账目 | P1 | M5 | registered/enabled/effective 与测试数脚本化 |
| G10 | Vue fixture | P2 | M5 | script setup/template/宏/样式多场景 fixture |
| G16 | 输入面/重复输入 | P2 | M5 | arch glob、ignore、输入 Set 去重与回归 |
| G11 | 发布/供应链 | P2 | M6 | changesets、多平台产物、校验和、SBOM、签名 |
| G17 | opt-in 规则对账 | P2 | M6 | 版本/能力协商；陈旧二进制可告警 |

> 全量核对：M4 10 项 + 本表 7 项 = G1–G17，无遗漏。

## 3. M5（P1）— 深度与规模化

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
  - owner：engine + type-aware
  - 内容：Pinia action、axios 返回、composable 按需开启；默认关闭可配置。
  - 验收：tsgolint 缺失自动降级；误报消解有数据。
- [ ] **增量与性能（G5）**
  - 内容：接受 scanner 变更集；反向依赖影响面；`--concurrency`；内存上限。
  - 验收：10 万行全量 <60s / 增量 <5s；1 万文件资源有界。
- [ ] **工程支撑：G4/G7/G10/G16**
  - G4 Rust IR；G7 文档/规则账目；G10 Vue fixture；G16 输入面与重复输入。
- [ ] **基准扩展**
  - 内容：每规则 TP/FP/FN；季度误报复盘。
  - 验收：基准趋势可追踪。

## 4. M6（P2）— 生态与框架扩展

- [ ] Angular profile（需求门控：无目标仓不启动）
- [ ] React/Next profile（含 React 框架语义；不默认进 Vue 项目）
- [ ] Svelte/Nuxt/Remix（按需）
- [ ] LSP alpha + VS Code
- [ ] `lintsight migrate` 完整版
- [ ] fixer 高级策略、上游 oxc 跟进
- [ ] G11 发布/供应链（changesets、多平台产物、校验和、SBOM、签名）
- [ ] G17 opt-in 规则对账

> **平台职责（不在本仓）**：常驻 worker/daemon、任务/上传/基线/抑制同步、AI 研判调度、CI/CD 编排、扫描机调度。原 M6 的“常驻 worker”归 scanner/平台，不从引擎排期。

## 5. 明确不做（防范围蔓延）

- 不用 200 条语法规则冲数量。
- 不自建 TypeScript 类型检查器（继续用 tsgolint）。
- 不把任务/上传/基线 UI/AI 研判塞进引擎（scanner/平台职责）。
- 不在无目标仓时提前做 Angular/React。
- 不用规则级 confidence 常量冒充逐 finding 置信度。
- 不先做缓存性能优化而跳过正确性。
- 不用 LLM 自动修 taint。

## 6. M4 退出条件（Exit Gate）

- [ ] M4 全部 P0（W1–W6）`[x]`，且每项有证据。
- [ ] 外部依赖：H4 覆盖矩阵与双跑对照已签字；未签字则只能出“未闭合”例外报告，不能宣称替代验收通过。
- [ ] 445 文件目标仓全量冷扫 <10s；百文件增量 <1s。
- [ ] 冷/热扫诊断集合一致（重复内容、断环、tsconfig、重复输入）。
- [ ] scanner 可直接消费 JSON/SARIF/exit code，签字确认。
- [ ] 没有任何 P0 项以“后续补”关闭。

## 7. 状态更新规则

- 每周更新一次状态；`[!]` 必须写阻塞原因、owner、影响与 fallback。
- 完成项必须附证据（命令输出、测试名、报告路径、指标阈值）。
- 计划变更先改 [upgrade-plan.md](upgrade-plan.md)，再同步本清单；不反向修改决策。
- 同一工作项只允许一个 owner；跨 owner 时拆子项，不共享状态。
