# lintsight 独立评审报告（v0.1）

> **评估快照**：`HEAD 027fd8f10d6795e554fde6e6f1ab86c718dcea14`（2026-10-29）
> **工作区状态（评估开始时）**：`M AGENTS.md`、`M README.md`、`M crates/lintsight-engine/src/arch.rs`、`M docs/spikes/vertical-slice-m1.md`、`D docs/todo.md`、`M package.json`、`?? .agents/memory/`、`?? docs/upgrade/`。即本次评审看到的是“含未提交升级计划与文档修订”的工作树，不是干净 commit。
> **环境**：Windows；Bun 1.4.2；oxlint 1.83.0；Rust 1.97.1；hyperfine 不可用；`corpus/repos/` 未同步。
> **口径**：`实测`=命令/代码；`自报`=文档声明；`推断`=由证据推理；`观点`=评分判断。平台职责（任务、上传、基线、AI 研判、CI/CD）不计入扣分；引擎侧契约与 inline suppression 计入。
> **本报告位置**：`docs/upgrade/v0.1/review-report-v0.1.md`。除本报告文件外，未修改源码、配置或既有文档。
> **Errata（2026-10-29）**：H1「安全价值为 0」等口径已在 [upgrade-plan §0.5](upgrade-plan.md#05-评审分歧与口径修正) 修正；本报告的 processor 语义与「无 SQL」表述已同步修正（§6/B1），其余内容保持评审快照原样。

## 0. 结论

| 视角 | 总分 | 判断 |
| --- | --- | --- |
| **MVP 视角** | **6.0 / 10** | 可试点：能扫描真实仓库、输出 JSON/SARIF、指纹稳定、工程纪律扎实；适合做缺口发现与内部试用。 |
| **企业级替代视角** | **3.3 / 10** | 未就绪：检测深度停在 D2、无跨过程/框架语义、无可复核的精确基准、增量缓存不正确、契约字段缺失。 |

**一句话判断**：lintsight 当前是“oxlint 正确性 lint + 小规模过程内 taint + 证据链骨架”，不是“可替代现有 JS/TS SAST 的检测引擎”；工程质量不能抵消检测深度与评估证据的不足。

**三个决定性差距（按企业替代影响排序）**

| # | 差距 | 关键证据 |
| --- | --- | --- |
| 1 | **检出深度与覆盖不足**：仅过程内 taint，5 条 taint 规则；source 极窄；SQL 仅有语法版 `no-sql-concat`，缺 ORM/NoSQL/XXE/反序列化 taint；无 Vue template、无 JSX sink。 | [taint.rs](../../../crates/lintsight-engine/src/taint.rs#L63-L79) 的 path-traversal source 只有 `fs.readdirSync`；引擎直测 `fs.readFileSync(req.query.file)` 输出仅 summary、0 诊断；[rules.rs](../../../crates/lintsight-engine/src/rules.rs#L405-L412) 仅注册 6 条常驻规则。 |
| 2 | **精度/召回证据不成立**：无逐行标注、无逐规则 TP/FP/FN、无独立复核；juice-shop 召回是“锚点文件内任意自有规则命中”。 | [corpus-recall.ts](../../../scripts/corpus-recall.ts#L116-L136) 判定 `rules.size > 0` 即 recalled；[corpus/baseline-v0.json](../../../corpus/baseline-v0.json) 3453 条中 54.8% 是 `no-unused-expressions`/`no-unused-vars`，引擎仅 14 条（0.41%）。 |
| 3 | **增量缓存与契约不可信**：缓存键不含文件路径导致同内容文件诊断错配；干净文件永不入缓存；图规则只看到缓存未命中文件；输出无 confidence/cweTags/fail-on，降级不可观测。 | [cache.ts](../../../packages/lintsight-cli/src/cache.ts#L152-L159)、[pipeline.ts](../../../packages/lintsight-cli/src/pipeline.ts#L453-L460)、[pipeline.ts](../../../packages/lintsight-cli/src/pipeline.ts#L496-L504)；实测热扫输出 `b.ts` 两次、`a.ts` 零次；断环后热扫仍报陈旧 cycle，冷扫为 0。 |

**什么证据会改变上述判断**

| 结论 | 可证伪条件 |
| --- | --- |
| 检出深度不足 | 在目标栈（Vue 3 + Nest/Express）上提供 50+ 精确漏洞行样本，lintsight 召回不低于现有引擎、security FP <10%；代码演示 `req→fs`、`req→exec`、ORM→SQL、跨函数传播均带 pathEvents；Vue `v-html`/动态 `:href`、JSX sink 可命中。 |
| 评估不可信 | 双盲标注 100+ 诊断并给出逐规则 TP/FP/FN；与现有引擎同 commit 双跑对齐率 ≥95%；基准报告由脚本生成且可复现。 |
| 增量/契约不可用 | 冷/热扫等价测试覆盖“重复内容文件、断环、tsconfig 变更”；缓存键含路径；报告含 confidence/cweTags/fail-on/engineStatus；scanner 可直接消费的集成测试通过。 |

## 1. 评分卡

| 维度（权重） | MVP | 企业替代 | 两条证据 |
| --- | --- | --- | --- |
| **SAST 检测深度与规则覆盖（25）** | **5.5** | **3.0** | ① 自有 27 JS + 9 engine 注册；仅 5 条过程内 taint；语料 3453 条中引擎 14 条（0.41%）。② `fs.readFileSync(req.query.file)` 引擎 0 命中；SQL 仅有语法版 `no-sql-concat`，缺 ORM/NoSQL/XXE taint；Vue template、JSX sink 缺失。 |
| **精度/召回与评估方法（20）** | **5.0** | **2.5** | ① 27/27 规则有 `falsePositives`，有语料基线、双报门禁、golden、指纹 diff。② juice-shop 判定为“锚点文件内任意自有规则命中”（17/26，总口径 17/111）；语料 54.8% 是风格/清理规则；无逐行标注、无独立复核、无负样本集。 |
| **架构设计与可演进性（20）** | **7.0** | **4.0** | ① 包级分层清晰（cli/config-bridge/diagnostic/formatter/vue-processor/rule-sdk），sidecar JSONL、排序与指纹设计合理。② 缓存键缺路径/tsconfig/依赖闭包；图规则只跑 miss 文件；Rust 规则直接依赖 oxc AST；无 FrameworkProfile/通用 Processor。 |
| **工程质量/测试/CI（15）** | **7.5** | **4.5** | ① `bun run test` 167 pass、`cargo test --release` 52 pass；lint/format 0 错误；fixtures/golden/注册表一致性测试齐备；oxlint/oxc 精确锁。② 无 `.github/`、无 `.gitlab-ci.yml`；`bun run test` 不含 cargo；无 fuzz、无超时/大小上限、bench 基线未重跑。 |
| **平台契约与集成（10）** | **6.0** | **3.5** | ① JSON/SARIF/fingerprint/exit 0/1/2/pathEvents 已具备；SARIF 有 codeFlows/relatedLocations。② 无 confidence/cweTags/`--fail-on`；`degraded` 不进报告；SARIF 无 taxonomies；`--version` 报 0.0.1；外部路径报告为绝对路径。 |
| **框架扩展性与解耦（10）** | **4.5** | **2.0** | ① Vue processor 独立包、位置 1:1 回映射、fix 回写有测试。② `.vue` 硬编码在 pipeline；template 不分析；TSX/JSX 零 fixture；Angular/React/Nest/ORM 未建模；无 Profile/RulePack 加载器。 |

**加权总分**：MVP = 5.5×0.25 + 5.0×0.20 + 7.0×0.20 + 7.5×0.15 + 6.0×0.10 + 4.5×0.10 = **5.95 ≈ 6.0**；企业 = 3.0×0.25 + 2.5×0.20 + 4.0×0.20 + 4.5×0.15 + 3.5×0.10 + 2.0×0.10 = **3.275 ≈ 3.3**。分差主要来自检测（−0.625）、评估（−0.5）、架构（−0.6）、框架（−0.25）；MVP 视角给工程与架构的“可运行、可集成”信用，企业视角要求 D3、覆盖矩阵、精确基准、框架 Profile 与流水线门禁。评分不确定性约 ±0.5（语料/bench 未重跑）。

## 2. 声明 vs 事实

| 声明 | 来源 | 实测/证据 | 差异/口径 |
| --- | --- | --- | --- |
| 内置规则 865+；升级计划称注册 900 | [README.md](../../../README.md#L18)、[upgrade-plan.md](../../../docs/upgrade/v0.1/upgrade-plan.md#L96) | `bunx oxlint --rules`：类别标题合计 **870**，表格 877 行，唯一规则名 **807**；生成配置 `number_of_rules=**123**`（96 native + 27 自有）。 | 865+/900 是“注册面”；123 是“启用面”；实测一次仓库扫描仅 2 条诊断。“865+/900/123”三个数都不是“有效检测能力”。900 不可复现。 |
| 自有规则 36 条（JS 27 + 引擎 9） | [README.md](../../../README.md#L28) | 插件产物 `Object.keys(rules).length=27`；注册表 36 条；引擎 `summary.rules` 默认 6 条，带 arch/enforceExports 时 8 条；`no-import-cycle` 是图 pass，不在 `rules` 列表。 | 36 是“注册”；9 是“注册表”；运行时常驻仅 6 条；默认无 arch 配置时治理规则也不注册。 |
| 深度引擎 1.39M LOC/s；端到端 207ms | [README.md](../../../README.md#L36) | [bench-baseline.json](../../../scripts/bench-baseline.json)：8ms / 10,700 行 ≈ 1.34M LOC/s；207ms ≈ 51.7k LOC/s。 | 引擎单测吞吐 vs 端到端两口径；自报且未重跑（hyperfine 不可用）。性能数字不能推断检测能力。 |
| `bun 140 + cargo 46` | [README.md](../../../README.md#L277) | 实测 `167 pass` / `52 passed`。 | 文档数字过期。 |
| `--output` 报告写入文件、不污染 stdout | [README.md](../../../README.md#L213) | [cli.ts](../../../packages/lintsight-cli/src/cli.ts#L76-L82) 写文件后仍 `console.log(formatted)`。 | 文档与实现不符；平台若同时读 stdout 文件会重复。 |
| fail-open 自动降级 | [README.md](../../../README.md#L31) | 引擎二进制缺失时 [engine-bridge.ts](../../../packages/lintsight-cli/src/engine-bridge.ts#L206-L209) 返回 `degraded=false` 且不告警；`degraded` 不进报告（[pipeline.ts](../../../packages/lintsight-cli/src/pipeline.ts#L125)），与 [design-m2](../../../docs/design/design-m2-v0.1.md#L121) “报告 degraded:true”矛盾。 | 最危险的降级形态（引擎缺失）完全静默；安全扫描会少掉全部 taint 结果且 exit 0。 |
| Vue SFC 支持 | [README.md](../../../README.md#L34) | [vue-processor](../../../packages/lintsight-vue-processor/src/index.ts#L19) 明确“template 不分析”；实测 `.vue` 中 `v-html` 无诊断；未显式配置 `eslint/no-unused-vars` 时 [pipeline.ts](../../../packages/lintsight-cli/src/pipeline.ts#L507-L518) 对全部 `.vue` 抑制该规则，实测 0 诊断。 | 支持的是 `<script>` 虚拟块，不是 Vue 语义；抑制不是语义修复。 |
| juice-shop 65.4%（17/26） | [juice-shop-recall-v0.3.md](../../../docs/spikes/juice-shop-recall-v0.3.md#L42) | [corpus-recall.ts](../../../scripts/corpus-recall.ts#L116-L136) 只要锚点文件有任意自有规则即 recalled；`EXTRA_ANCHORS` 为人工补充锚点；17/111 = 15.3%。 | 分母是“有静态锚点的 26 个”，判定是“锚点文件任意命中”；不是逐行召回。 |
| 语料库 3453 条诊断、5596 文件 | [README.md](../../../README.md#L30)、[upgrade-plan](../../../docs/upgrade/v0.1/upgrade-plan.md#L102) | [baseline-v0.json](../../../corpus/baseline-v0.json)：total=3453；`no-unused-expressions` 978 + `no-unused-vars` 915 = 54.8%；引擎 14 条；`corpus/repos/` 不存在，文件数未验证。 | 语料是“lint 风格面”而非“安全精度基准”；引擎贡献 0.41%；无逐条标注。 |
| CI 模板与二进制分发 | [README.md](../../../README.md#L222-L258) | `Test-Path .github` / `.gitlab-ci.yml` / `.changeset` 均为 False；仓库只有 README 片段。 | “门禁”目前是脚本，不是流水线；发布产物/校验和未入库。 |
| README 示例 `contractVersion: "1"` | [README.md](../../../README.md#L73) | [diagnostic/index.ts](../../../packages/lintsight-diagnostic/src/index.ts#L9) `CONTRACT_VERSION='2'`；实测报告为 2。 | 文档示例过期；pathEvents 是 v2 字段。 |
| cleancode 1795 → 38（28 真实/8 噪音/2 FP） | [upgrade-plan](../../../docs/upgrade/v0.1/upgrade-plan.md#L113-L114) | 仓内无该扫描报告/标注文件；无独立复核记录。 | 自报，无法复核；不能作为对外精度证据。 |

## 3. 架构评估

分层与包边界是清晰的：CLI 只做编排，config-bridge/diagnostic/formatter/vue-processor 独立；sidecar 单向 JSONL、失败不阻塞的总体方向正确。但“可演进”在三个关键点上没有兑现：解析器抽象只覆盖 JS 轨道、缓存/增量不成立、框架扩展仍是改内核。

| 子项 | 结论 | 证据 |
| --- | --- | --- |
| 分层/依赖方向 | 包级分层好；但 pipeline 仍包含框架分支与扫描面硬编码，配置发现绑定 cwd。 | [pipeline.ts](../../../packages/lintsight-cli/src/pipeline.ts#L281-L290)；[config-bridge](../../../packages/lintsight-config-bridge/src/index.ts#L434-L442)。 |
| 解析器可替换 | JS 轨道走 ESLint 兼容 API，未 import parser；Rust 轨道直接 `use oxc_ast/oxc_semantic/oxc_cfg`，铁律 #2 仅名义兑现。 | [rule-sdk](../../../packages/lintsight-rule-sdk/src/index.ts#L42-L69)；[rules.rs](../../../crates/lintsight-engine/src/rules.rs#L9)；[context.rs](../../../crates/lintsight-engine/src/context.rs#L12-L15) 且 `FileContext::semantic()` 直接返回 `&Semantic`。 |
| sidecar 协议 | JSONL 简单、单向、可测试；但无协议版本、无能力协商、无 `profileId`，输入只有 files/arch/tsPaths。 | [protocol.rs](../../../crates/lintsight-engine/src/protocol.rs#L5-L14)；[engine-bridge.ts](../../../packages/lintsight-cli/src/engine-bridge.ts#L195-L228)。 |
| 确定性 | 排序 `(file, offset, ruleId)`、指纹 `sha256(ruleId+file+span+message)` 设计正确；但缓存路径破坏端到端确定性。 | [diagnostic/index.ts](../../../packages/lintsight-diagnostic/src/index.ts#L220-L228)；实测重复内容缓存错配、断环热扫陈旧。 |
| 增量/缓存 | 缓存键不含文件路径、tsconfig、依赖闭包、文件集；引擎只接收 misses；干净文件不写缓存。 | [cache.ts](../../../packages/lintsight-cli/src/cache.ts#L152-L159)；[pipeline.ts](../../../packages/lintsight-cli/src/pipeline.ts#L453-L460)；[pipeline.ts](../../../packages/lintsight-cli/src/pipeline.ts#L496-L504)；需求 §3.4 明确要求依赖闭包+tsconfig（[requirements](../../../docs/requirements/requirements-v0.2.md#L315)）。 |
| 并发/内存 | 每文件独立 arena、rayon 保序收集是优点；但引擎用 rayon 默认全核、无 `--concurrency`；oxlint 按 28k 字符分批后 `Promise.all` 无上限并发，每次 oxlint 又用 20 线程。 | [main.rs](../../../crates/lintsight-engine/src/main.rs#L66-L95)；[pipeline.ts](../../../packages/lintsight-cli/src/pipeline.ts#L375-L392)；实测 oxlint JSON `threads_count=20`；需求要求 min(cpu−1,8) 与 `--concurrency`（[requirements](../../../docs/requirements/requirements-v0.2.md#L334)）。 |
| 健壮性 | 无单文件超时、无大小上限、无 fuzz；`read_to_string` 整文件读入；超大文件不分流。 | grep `timeout|AbortSignal|setTimeout` 在 pipeline/engine-bridge/oxlint-bridge 零命中；需求 >1MB 告警/单线程未实现（[requirements](../../../docs/requirements/requirements-v0.2.md#L336)、[#L391](../../../docs/requirements/requirements-v0.2.md#L391)）。 |
| fail-open 可观测 | 缺失引擎静默；崩溃只写日志；`degraded` 不进报告/退出码；无 fail-closed 选项。 | [engine-bridge.ts](../../../packages/lintsight-cli/src/engine-bridge.ts#L206-L209)；[pipeline.ts](../../../packages/lintsight-cli/src/pipeline.ts#L462-L466)；[design-m2](../../../docs/design/design-m2-v0.1.md#L121)。 |
| 部署/分发 | `build:binary` 可产单文件 + Rust 产物；oxlint 为伴生依赖；无 CI 发布、无多平台产物/校验和。 | [package.json](../../../package.json#L18)；README 命名约定无工作流；无 `.github/` / `.changeset`。 |

## 4. SAST 专业性

总体处于 **L0-L2 扎实、L3 刚起步、L4 缺失**：AST/scope/CFG 基建可用，过程内 taint 有正确性设计（表交叠校验、不动点、span 去重、证据链），但 source/sink 覆盖与语义建模远不足以支撑企业级 SAST。

| 子项 | 结论 | 证据 |
| --- | --- | --- |
| 检测深度 | L0/L1/L2 具备；L3 仅 5 条 taint 规则、过程内；无函数摘要、无调用图、无跨文件传播；type-aware 默认关闭。 | [rules.rs](../../../crates/lintsight-engine/src/rules.rs#L405-L412)；[taint.rs](../../../crates/lintsight-engine/src/taint.rs#L247-L308) 按文件构建 CFG；无摘要/调用图符号。 |
| 规则质量 | 27 条 JS 规则 meta 完整（falsePositives 27/27、3 bad/2 good）；但多为语法/命名启发：`no-innerhtml` 任何非字面量都报、`no-sql-concat` 只看 SQL 前缀、`no-floating-promise` 靠同文件 async 名/Async 后缀、`no-non-literal-fs-filename` 只认标识符且名字含 path/file/dir。 | [no-innerhtml-assignment.js](../../../packages/rules-core/src/rules/no-innerhtml-assignment.js#L28-L53)；[no-sql-concat.js](../../../packages/rules-core/src/rules/no-sql-concat.js#L26-L49)；[no-floating-promise.js](../../../packages/rules-core/src/rules/no-floating-promise.js#L110-L193)；[no-non-literal-fs-filename.js](../../../packages/rules-core/src/rules/no-non-literal-fs-filename.js#L158-L188)。 |
| taint 正确性 | 单调只增的 SymbolId 集合 → 无 strong update/kill；`x = sanitize(x)` 不能清除既有污染；sanitizer 仅 `path.basename` 返回 None；source 仅 readdir 或硬编码 req 成员；命名导入不解析；无跨过程。 | [taint.rs](../../../crates/lintsight-engine/src/taint.rs#L207-L222) 只 `insert`；[taint.rs](../../../crates/lintsight-engine/src/taint.rs#L63-L79)；[taint.rs](../../../crates/lintsight-engine/src/taint.rs#L575-L589)；实测 `req.query.file` 0 命中。 |
| sanitizer/source/sink 建模 | 表驱动 + 登记期两两交叠校验是亮点；但表是硬编码名字，`REQUEST_SCOPE_NAMES` 还会把任意 `query/body/...` 局部变量当 source，存在 FP。 | [taint.rs](../../../crates/lintsight-engine/src/taint.rs#L58)；[taint.rs](../../../crates/lintsight-engine/src/taint.rs#L619-L635)；[rules.rs](../../../crates/lintsight-engine/src/rules.rs#L63-L350)。 |
| 框架语义 | Vue 仅 script；props/emits/macros 不建模；Express/Koa/Hono 仅靠 `req/ctx` 名字；Nest 装饰器/DTO、Angular template/DI/RxJS、React hooks、ORM 查询均缺失。 | [vue-processor](../../../packages/lintsight-vue-processor/src/index.ts#L19)；[taint.rs](../../../crates/lintsight-engine/src/taint.rs#L118-L131)；[rules.rs](../../../crates/lintsight-engine/src/rules.rs#L116-L150)。 |
| type-aware | opt-in，默认关闭；`typescript/no-misused-promises` 等映射未启用；无 type-aware taint。 | [config-bridge](../../../packages/lintsight-config-bridge/src/index.ts#L239-L245)；[builtin-mapping](../../../packages/lintsight-config-bridge/src/builtin-mapping.ts#L27-L30) `rules={}`。 |
| 误报/召回 | 有 falsePositives、测试文件豁免、语料基线、双报门禁；但无双盲逐行标注、无负样本集、无逐规则 TP/FP/FN；juice-shop 是锚点内任意规则命中。 | [corpus-recall.ts](../../../scripts/corpus-recall.ts#L116-L136)；[corpus-lib.ts](../../../scripts/corpus-lib.ts#L43-L54) 双报只是同 offset 跨 owner；baseline 组成见 §2。 |
| CWE/OWASP | 规则 meta 有 15 个 CWE 家族标签；引擎 CWE 只在 message 文本；诊断/SARIF 均不输出 cweTags，平台无法消费。 | [rules-core](../../../packages/rules-core/src/rules) 的 `tags`；[registry.ts](../../../packages/lintsight-diagnostic/src/registry.ts#L34-L380) 无 cwe 字段；SARIF 实测无 `taxonomies`。 |
| 证据链 | pathEvents 结构化、SARIF codeFlows/relatedLocations 双写、事件 line/column 正确；但仅过程内、PathEvent 无 file 字段，L4 跨文件不可表达。 | [diagnostic/index.ts](../../../packages/lintsight-diagnostic/src/index.ts#L46-L56)；[sarif.ts](../../../packages/lintsight-formatter/src/sarif.ts#L74-L83)。 |
| SARIF/抑制 | SARIF 2.1.0 结构合规、partialFingerprints 有；无 confidence/cwe/taxonomies/suppressions；无 inline ignore，基线/抑制只能靠平台按指纹做。 | [sarif.ts](../../../packages/lintsight-formatter/src/sarif.ts#L93-L175)；grep `lintsight-ignore` 在 packages 零命中；需求 §4.3 要求数据流规则提供 suppress 机制（[requirements](../../../docs/requirements/requirements-v0.2.md#L373-L375)）。 |

**对标可比性（不以规则数判死）**

| 对标 | 可比性 | 本次结论 |
| --- | --- | --- |
| `eslint-plugin-security` | 都是语法/启发式规则集；lintsight 多了 taint、指纹、SARIF、证据链。 | 语法面相近；lintsight 略强于 taint/消费面，但无同语料 TP/FP 数据，不能量化“更强”。 |
| Semgrep（OSS/Pro） | Semgrep 模式 + taint；OSS 以过程内为主，Pro 有跨过程/框架模型。 | lintsight 接近“小型 Semgrep OSS 规则包 + 自建证据链”；规则数、框架、跨过程远少；Pro 不可比。 |
| SonarJS | 基于 TypeScript 类型事实、成熟规则面。 | lintsight type-aware 默认关闭、无跨过程；检测深度低于 SonarJS。 |
| CodeQL | 全程序数据库、过程间数据流、框架库。 | 不同层，不可直接比较；lintsight 不在 CodeQL 的能力层级。 |
| 结论 | 规则数不可比；必须同语料、逐行标注、同 commit 双跑才能比较。 | 当前没有任何与上述工具的同语料对比数据。 |

## 5. 工程与交付

| 子项 | 结论 | 证据 |
| --- | --- | --- |
| 测试 | 167 bun + 52 cargo 全绿；RuleTester 3 bad/2 good、golden、注册表一致性、Vue processor、engine bridge、supersedes、arch/cycles 用例齐备。 | `bun run test` 输出 `167 pass`；`cargo test --release` 输出 `52 passed`。 |
| CI | 无 CI 配置；lint/format/bench/corpus 均靠人跑；`bun run test` 只跑 `./packages ./scripts`，不含 cargo。 | `Test-Path .github` False；[package.json](../../../package.json#L12)。 |
| fixture/golden | `.ts` 用例较全；`.vue` 仅 1 个；`.tsx/.jsx` 0 个；golden 149 文件/113 诊断。 | `fixtures/` 文件清单；[report-v2.json](../../../packages/lintsight-cli/test/__golden__/report-v2.json)。 |
| 版本/供应链 | oxlint 1.83.0、oxc =0.150.0、Bun ≥1.2，bun.lock/Cargo.lock 入库；`oxlint-tsgolint: "7"` 只锁大版本；引擎无 cargo-deny/SBOM/签名。 | [package.json](../../../package.json#L28-L33)；[Cargo.toml](../../../crates/lintsight-engine/Cargo.toml#L9-L17)。 |
| 跨平台 | 近期 Windows 路径/批处理修复；Windows 上测试、lint、format 全绿。 | git log `ea4f379`/`4b73641`/`af26af0`；本次 Windows 实测。 |
| 文档 | 需求/设计/DR/spike/skill 体系完整、版本化、DR 有否决理由；但有数字漂移、自报基准无产物。 | README/upgrade 数字与实测差异见 §2；`docs/upgrade` 尚未提交。 |
| 产物重建 | 规则产物 70,916 bytes、27 条规则；`build:rules` 重建后 git 无 diff。 | `bun -e "import p from './plugins/...'"` 输出 27；`git status` 无 plugins diff。 |
| bench baseline | `commit 5136929`（2026-10-05），当前 HEAD 已 19 个提交之后；hyperfine 不可用，未重跑。 | [bench-baseline.json](../../../scripts/bench-baseline.json)。 |

## 6. 框架扩展性专项

| 框架 | 现状 | 缺口 | 加支持要改的改动面 |
| --- | --- | --- | --- |
| **TSX/JSX** | `.tsx/.jsx` 在 `SCAN_EXTS`，oxc 可解析；零 fixture、零 JSX 专项规则；React 插件未启用。实测 `dangerouslySetInnerHTML`/`href={userInput}` 0 诊断。 | 语言“能解析”不等于“有契约”；JSX sink 不可见。 | `pipeline.ts`、`rules-core` 新规则、plugin 聚合、registry、fixtures/golden；React 插件配置。 |
| **Vue 3** | 仅 `<script>` 虚拟块；template 不分析；`defineProps/defineEmits/defineModel` 不建模；`.vue` 表内 `no-unused-vars` 默认整条抑制（实测 0 诊断）。 | 目标仓 183 个 `.vue`；`v-html`、动态 `:href/:src`、props source 均缺失；抑制导致脚本内真未使用变量也漏报。 | 新 template processor、pipeline 分支、config-bridge processor 分发、新规则包、fixtures；若做图规则还要处理虚拟路径身份。 |
| **Angular** | 只有 1 条 `no-unsafe-trust-bypass`（方法名匹配），不区分 DomSanitizer 实例；`.html` 不在扫描扩展。 | template AST、DomSanitizer、DI、RxJS、组件/指令全部缺失。 | `SCAN_EXTS` + `.html` processor + 新包 + taint 表 + registry + fixtures。 |
| **React** | 无任何框架语义；无 JSX 规则；React 插件未启用。 | hooks/server components/JSX sink 均无。 | JSX processor/规则包 + plugin 配置 + fixtures。 |
| **Nest/Express/ORM** | 仅 `req/ctx` 成员名硬编码 source；无路由/控制器入口、无 DTO 校验、无 ORM sink（Prisma/TypeORM/Sequelize/Mongoose）。 | SQL/NoSQL/ORM 的 taint 版缺失（语法版 `no-sql-concat` 存在），参数化 sanitizer 未建模；`req.query` 在非路由 helper 中也会被当 source（FP）。 | `rules.rs` 表、`taint.rs` 名字、profile 注册、ORM sink、规则包、Rust 重编译。 |

**加一个新框架的真实改动面**：至少 `pipeline.ts`（文件面与虚拟化分支）、`config-bridge`（processor/规则默认）、`engine-bridge`（输入能力）、`rules.rs`（source/sink 表）、`taint.rs`（名字与传播）、`rules-core/index.js` + 插件聚合、`registry.ts`、fixtures/golden，外加 Rust 重编译。当前**没有** `FrameworkProfile`、通用 `Processor`/`SemanticAdapter`、`RulePack` 加载器——grep 只在升级计划文档中出现这些名字；[config-bridge](../../../packages/lintsight-config-bridge/src/index.ts#L478-L486) 只判断 `processor` 是否存在，任意字符串都会触发 `suppressVueUnusedVars`；`.vue` 虚拟化在 [pipeline.ts](../../../packages/lintsight-cli/src/pipeline.ts#L280-L286) 无条件发生，`processor` 不是分发契约。

## 7. 关键问题清单

**Blocker**

| ID | 问题 | 证据 | 影响 | 修复与验收 |
| --- | --- | --- | --- | --- |
| B1 | 检出深度/覆盖不足以替代 | [taint.rs](../../../crates/lintsight-engine/src/taint.rs#L63-L79) path source 仅 readdir；引擎直测 `fs.readFileSync(req.query.file)` 仅 summary 0 诊断；[rules.rs](../../../crates/lintsight-engine/src/rules.rs#L405-L412) 6 条常驻；SQL 仅有语法版 `no-sql-concat`，缺 ORM/NoSQL/XXE/反序列化 taint。 | 企业替代的第一道门槛不成立；高危家族召回不可证明。 | 做 D3：函数摘要/调用图/参数返回传播/strong update；扩 source/sink（`req.*`、ORM、DOM/JSX、Vue template）；验收：目标栈 50+ 精确行样本召回≥现有引擎、security FP<10%。 |
| B2 | 增量缓存不正确 | [cache.ts](../../../packages/lintsight-cli/src/cache.ts#L152-L159) 键无文件路径；实测冷扫 `a.ts,b.ts`，热扫 `b.ts,b.ts`；[pipeline.ts](../../../packages/lintsight-cli/src/pipeline.ts#L496-L504) 只写有诊断的组（2 文件仅 1 缓存条目）；[pipeline.ts](../../../packages/lintsight-cli/src/pipeline.ts#L453-L460) 引擎只收 misses；实测断环后热扫仍报 `b.ts` cycle、冷扫 0。 | 热扫会漏报/错报/陈旧；CI 不可信。 | 键含路径+tsconfig+依赖闭包/影响集；缓存空结果；图规则全量 pass 或标不可缓存；验收：重复内容/断环/加文件/tsconfig 四场景冷热等价，corpus 上 cache/no-cache 诊断集合一致。 |

**High**

| ID | 问题 | 证据 | 影响 | 修复与验收 |
| --- | --- | --- | --- | --- |
| H1 | 默认安全规则全关，无推荐集 | [builtin-mapping.ts](../../../packages/lintsight-config-bridge/src/builtin-mapping.ts#L27-L30) `rules={}`、仅 correctness；[config-bridge](../../../packages/lintsight-config-bridge/src/index.ts#L316-L339) 只翻译显式 rules；实测 `rules:{}` 项目仅 `eslint/no-unused-vars`，27 条自有规则 0 启用；P0 1b 清单（`no-new-func`/`no-throw-literal`/`react/no-danger`/`promise/catch-or-return`/`unicorn/no-document-cookie`）未落地。 | 新项目开箱只做正确性 lint，安全价值为 0；用户必须手抄 27 条规则。 | 提供 `recommended`/`security` 预设；补齐 1b 映射；文档三口径；验收：空配置项目扫描已知坏样本能出安全诊断，预设测试锁定。 |
| H2 | Vue template 缺失 + 整条抑制 | [vue-processor](../../../packages/lintsight-vue-processor/src/index.ts#L19)；[pipeline.ts](../../../packages/lintsight-cli/src/pipeline.ts#L281-L286) 恒虚拟化 `.vue`；[pipeline.ts](../../../packages/lintsight-cli/src/pipeline.ts#L507-L518) 未显式配置就全量抑制；[config-bridge](../../../packages/lintsight-config-bridge/src/index.ts#L484-L486) 条件抑制；实测 `.vue` 中 `v-html` 0 诊断、`unusedInTemplate` 0 诊断。 | 目标栈 183 个 `.vue`：模板 sink 不可见、脚本真未使用变量漏报；显式启用规则又回到 1747 条系统性误报。 | template AST + 引用索引 + `defineXxx` 宏 + `v-html`/动态 `:href/:src` 规则；抑制只作过渡；验收：183 `.vue` 复扫无系统性误报且模板 sink 命中。 |
| H3 | 契约字段缺失、降级不可观测 | [diagnostic/index.ts](../../../packages/lintsight-diagnostic/src/index.ts#L71-L82) 无 confidence/cweTags；[sarif.ts](../../../packages/lintsight-formatter/src/sarif.ts#L93-L134) 无 taxonomies；[cli.ts](../../../packages/lintsight-cli/src/cli.ts#L14) 无 `--fail-on`；[engine-bridge](../../../packages/lintsight-cli/src/engine-bridge.ts#L206-L209) 缺引擎时 `degraded=false` 且无告警；[pipeline.ts](../../../packages/lintsight-cli/src/pipeline.ts#L540-L548) exit 只看 severity。 | 需求 §4.3 “只拦 error+high”无法实现；SARIF 无法消费 CWE；引擎缺失静默少掉全部 taint。 | 契约 v3：confidence（按 finding 或至少逐规则）、cweTags、engineStatus/degraded、toolVersion；`--fail-on`；SARIF taxonomies/suppressions；验收：golden/SARIF 测试 + scanner 消费测试 + 缺引擎可见。 |
| H4 | 精度/召回与覆盖矩阵不成立 | [corpus-recall.ts](../../../scripts/corpus-recall.ts#L116-L136) 任意规则命中即 recalled；[EXTRA_ANCHORS](../../../scripts/corpus-recall.ts#L36-L57) 人工补锚；baseline 54.8% 风格规则、引擎 0.41%；cleancode 38 无仓内产物；无逐行标注。 | 无法证明“不低于现有引擎”；对外数字不可提交评审。 | 30~50 精确漏洞行样本 + 10 干净仓库；逐规则 TP/FP/FN；同 commit 双跑≥95%；独立复核；验收：脚本生成 `benchmark-vX.md`，security FP<10%。 |
| H5 | 框架扩展仍是改内核 | [pipeline.ts](../../../packages/lintsight-cli/src/pipeline.ts#L281-L290) `.vue` 硬编码；[config-bridge](../../../packages/lintsight-config-bridge/src/index.ts#L157-L162) processor 只校验不分发；[rules.rs](../../../crates/lintsight-engine/src/rules.rs#L63-L350) 表硬编码；[rules-core/index.js](../../../packages/rules-core/src/index.js#L6-L32) 静态 import 单产物；无 Profile/RulePack grep。 | 加 Angular/Nest/React 要改 6~9 处 + Rust 重编译；语义表在 JS/Rust 两处漂移。 | `FrameworkProfile` 注册表（数据型 JSON）、通用 Processor 分发、多 jsPlugins/RulePack 加载器；先 Vue + Nest 验证；验收：新增数据型 profile 不改 Rust；模板适配器接口稳定。 |
| H6 | CI/健壮性缺口 | `.github/` 不存在；[package.json](../../../package.json#L12) 不含 cargo；grep 无 timeout/size；[pipeline.ts](../../../packages/lintsight-cli/src/pipeline.ts#L375-L392) 无上限 `Promise.all`；oxlint `threads_count=20`；[main.rs](../../../crates/lintsight-engine/src/main.rs#L66-L95) rayon 全核；无 fuzz。 | 门禁靠人；大仓可能线程爆炸/OOM/挂死；无回归防线。 | GitHub Actions（bun+cargo+lint+format+bench+corpus）；`test:all`；每文件超时/大小上限；`--concurrency`；fuzz；验收：CI 红阻断合并，1 万文件资源有界，超时测试。 |
| H7 | Rust 轨道未兑现铁律 #2 | [rules.rs](../../../crates/lintsight-engine/src/rules.rs#L9) `use oxc_ast::AstKind`；[context.rs](../../../crates/lintsight-engine/src/context.rs#L113-L115) 返回 `&Semantic`；[arch.rs](../../../crates/lintsight-engine/src/arch.rs#L23)；[taint.rs](../../../crates/lintsight-engine/src/taint.rs#L31-L36)。 | “解析器可替换”只对 JS 轨道成立；oxc 升级会穿透规则。 | 薄 IR façade（或明确修订铁律为“Rust 绑定 oxc”）；验收：规则不直接 import oxc AST，oxc 升级改动收敛到 context。 |
| H8 | TSX/JSX 无契约 | [pipeline.ts](../../../packages/lintsight-cli/src/pipeline.ts#L67-L75) 含扩展；fixtures 无 `.tsx/.jsx`；实测 `Comp.tsx` 的 `dangerouslySetInnerHTML`/`href={userInput}` 0 诊断；`rules-core` 无 JSX 规则。 | “支持 TSX/JSX”不可验证；React XSS 不可见。 | JSX 解析 fixture、JSX sink 规则包、React 插件启用；验收：TSX 坏/好用例矩阵 + JSX sink 命中。 |
| H9 | 配置/路径契约不适配 scanner | [config-bridge](../../../packages/lintsight-config-bridge/src/index.ts#L434-L442) 配置按 cwd 解析；CLI 无 `--cwd/--root`；实测扫描外部绝对路径，报告 file 为 `C:/Users/...` 绝对路径。 | scanner 若不 chdir，目标项目配置被忽略、报告路径不可映射。 | 明确 contract：cwd=项目根或提供 `--root`；路径归一/配置发现测试；验收：扫描外部目标用其自身配置且报告相对路径。 |

**Medium**

| ID | 问题 | 证据 | 影响/修复 |
| --- | --- | --- | --- |
| M1 | 版本三处不一致 | `--version` 报 `0.0.1`；CLI package 0.0.1；根 package 0.1.0-alpha.0；engine 0.1.0；SARIF `driver.version=0.0.1`。 | 发布/缓存/平台对账混乱；单一版本源 + 发布检查。 |
| M2 | 基线陈旧/语料偏科 | `baseline-v0.json` engine `lintsight@0.0.1`；bench baseline `5136929`；语料 54.8% 风格规则、引擎 0.41%。 | 漂移门禁失去意义；按版本重建 + 独立安全语料。 |
| M3 | 无 inline suppression | grep `lintsight-ignore` 零命中；需求 §4.3 要求行内 ignore + 平台白名单。 | taint FP 无法逐行豁免，团队会整条禁用；实现带 reason 的 ignore + SARIF suppressions。 |
| M4 | Vue 虚拟路径进入图身份 | [pipeline.ts](../../../packages/lintsight-cli/src/pipeline.ts#L293-L305) 引擎收到 `Foo.vue.lintsight-<pid>.ts`；[main.rs](../../../crates/lintsight-engine/src/main.rs#L81-L84) 以该 rel 建图边。 | 指向 `Foo.vue` 的 import 与虚拟节点不同键，Vue 参与的环漏报；图节点需映射回原路径。 |
| M5 | opt-in 规则无对账 | [engine-bridge](../../../packages/lintsight-cli/src/engine-bridge.ts#L154-L158) 把 arch/cycle/deep-import 排除；[main.rs](../../../crates/lintsight-engine/src/main.rs#L161-L166) summary 不含 `no-import-cycle`。 | 陈旧二进制缺 opt-in 规则不会告警；对账应覆盖可配置面或版本协商。 |
| M6 | arch glob 能力与文档不符 | [arch.rs](../../../crates/lintsight-engine/src/arch.rs#L52-L62) `*` 仅支持“前缀*后缀”单星，`{}`/多星不支持。 | 用户写复杂 glob 会静默失配；文档标注或换 globset。 |
| M7 | 默认忽略误伤/不足 | [pipeline.ts](../../../packages/lintsight-cli/src/pipeline.ts#L76-L92) 任意段 `build`/`out` 都跳过；`docs/assets` 仍需用户 ignore。 | 源码目录名为 build/out 会静默漏扫；跳过清单应可配置并告警。 |
| M8 | 依赖/供应链 | `oxlint-tsgolint: "7"` 浮大版本；引擎无 cargo-deny/SBOM/签名/校验和。 | type-aware 行为漂移；发布不可追溯；精确锁 + 审计 + 签名。 |
| M9 | 重复输入可能重复诊断 | `collectFiles` 返回 `groups.flat().sort()` 未去重。 | `lintsight src src` 或重叠根会重复报告；Set 去重。 |

**Low**

| ID | 问题 | 证据 |
| --- | --- | --- |
| L1 | 文档漂移 | `--output` 仍 stdout；README 示例 contractVersion 1；README `cd sast-engine`；`140+46` 过期。 |
| L2 | SARIF 无 golden/上传实测 | 只有结构单测；无 GitHub/GitLab 上传记录；需 CI 实测。 |
| L3 | 无发布产物/校验和 | 无 release workflow、无 `lintsight-<os>-<arch>` 产物入库。 |
| L4 | 无 clippy/cargo fmt | `bun run lint` 只覆盖 packages+plugins；Rust 仅 cargo test。 |

## 8. 路线图建议

| 阶段 | 工作 | 验收 |
| --- | --- | --- |
| **P0（M4，先修可信度）** | ① 缓存正确性（键含路径/tsconfig/依赖；空结果缓存；图规则全量或不可缓存；冷热等价测试）② 契约 v3（confidence/cweTags/fail-on/degraded/toolVersion/inline ignore）③ CI（bun+cargo+lint+format+bench+corpus）④ 推荐安全规则集 + 1b 映射 ⑤ Vue template v1 + 恢复 no-unused-vars ⑥ TSX 契约 ⑦ 超时/大小上限/并发参数 | 冷/热诊断集合一致；scanner 无改造消费；空配置项目能出安全诊断；183 `.vue` 无系统性误报；CI 红阻断合并 |
| **P1（M5，做深度）** | D3 函数摘要/调用图/参数返回传播/strong update；10~12 条 taint（SQL/NoSQL/XSS DOM/SSTI/XXE/反序列化/zip slip/header/JWT）；FrameworkProfile + Express/Nest/ORM profile；type-aware 策略；变更集增量；基准扩展 | 跨文件 taint 带 pathEvents；高危家族规则误报<15%；Nest/Express 目标仓可跑；同 commit 双跑≥95% |
| **P2（M6，生态）** | Angular/React profile（需求门控）；LSP/VS Code；多平台发布/校验和/签名；平台远端缓存（归 scanner） | 真实目标仓驱动；发布可追溯；不提前做无需求框架 |

**明确不该做**：不要用 200 条语法规则冲数量；不要自建 TypeScript 类型检查器（继续用 tsgolint）；不要把任务/上传/基线 UI/AI 研判塞进引擎；不要在无目标仓时提前做 Angular/React；不要用“规则级 confidence 常量”冒充逐 finding 置信度；不要缓存性能优化先于正确性；不要用 LLM 自动修 taint。

**对 M4 升级计划的独立意见**：计划方向正确、G1~G11 多数成立，且边界与“覆盖矩阵优先于规则数量”的判断值得保留。但它低估了三件事：G1 不只是“图规则只跑 miss”，还包括“缓存键无路径导致跨文件错配”和“干净文件永不缓存”；未指出“默认安全规则全关/无推荐集”；未指出并发/线程爆炸、配置 cwd、版本漂移。建议增补 G12~G16，并把“900 注册”改为实测口径。

**如果只能做三件事**

1. **修缓存正确性 + 契约 v3 + CI**：否则 scanner 接入第一天就会被热扫错报/漏报和无法门禁打回；这是“可信”的前置。
2. **做 D3 + 扩 source/sink + Vue template/JSX sink**：这是“能检出”的核心；没有跨过程和高危家族，规则再多也只是语法扫描器。
3. **建逐行标注基准 + 覆盖矩阵 + 双跑**：这是“能被信任/能替代”的证据；没有它，所有召回/精度数字都不可提交评审。

## 9. 开放问题与信息缺口

| # | 问题 | 为什么需要 |
| --- | --- | --- |
| 1 | 现有 JS/TS 引擎的规则目录、样例诊断、误报口径 | L1 覆盖矩阵与 L2 双跑的前提；当前完全不可见。 |
| 2 | scanner 的调用契约：cwd/config/变更集/并发/输出 schema 版本 | 决定 H9 的严重度与集成返工量；当前引擎无 `--root`。 |
| 3 | 语料库授权与 CI 同步能力；6 仓库能否在 CI 克隆 | `corpus:check` 现在未同步；CI 门禁是否可行未知。 |
| 4 | 基线/抑制是否由平台按 fingerprint 做；inline ignore 是否由引擎做 | 需求 §4.3 要求引擎提供 suppress；平台边界需确认。 |
| 5 | 目标 Vue/Nest 仓库可用性与 Angular/React 真实需求 | 决定 P0/P1 优先级；避免提前做无目标仓的框架。 |
| 6 | 目标 tsconfig（TS5/TS7、baseUrl/paths）与 tsgolint 行为 | type-aware 的收益/降级路径未在目标仓验证。 |
| 7 | Vue template 解析方案（`@vue/compiler-sfc` vs 自研）与依赖政策 | 影响包体积、供应链、虚拟块方案。 |
| 8 | 发布/签名/校验和/多平台产物的 owner | 当前只有构建脚本，无 release 流程。 |
| 9 | 可接受的 fail-open 策略：CI 是否必须 fail-closed | 引擎缺失静默会让安全扫描“看起来成功”。 |
| 10 | 独立标注人员与仲裁机制 | 没有独立复核，精度数字无法对外。 |

## 10. 评审方法与局限

| 项 | 结果 |
| --- | --- |
| 已运行 | `git rev-parse HEAD` / `git status --short` / `git log`；`bun run test`（167 pass）；`cargo test --release`（52 pass）；`bun run lint`（0 warnings/0 errors，103 rules）；`bun run format:check`；`bunx oxlint --rules`；生成配置直跑 oxlint（123 rules）；CLI 扫仓库/ fixtures/临时工程；引擎 stdin 直测；缓存/重复内容/断环/Vue/TSX/外部路径探针；`--version`。 |
| 未运行/未验证 | `bun run bench`（hyperfine 不可用）；`corpus:check`/`corpus:recall`（`corpus/repos/` 不存在，需联网克隆）；type-aware/tsgolint；SARIF GitHub/GitLab 上传；macOS/Linux；fuzz；cleancode 复扫；juice-shop 重跑。 |
| 工作区变化 | 评估前工作树已脏（见开头）。`bun run test` 重建了 `plugins/lintsight-rules/index.js`，但 git 无 diff；`.lintsight-cache/` 被重新生成（gitignore）；临时探针脚本写在系统 temp；本报告是唯一新增文档，未修改源码、配置或既有文档。 |
| 事实/推断/观点 | “167/52、123 rules、缓存输出、SARIF 字段、direct req 0 命中”是实测；“企业替代分数、风险影响”是观点/推断；“1.39M LOC/s、cleancode 38、juice-shop 17/26”是自报或自报口径核对。 |
| 局限 | 单机 Windows；未跑跨平台；未接触现有引擎清单；无语料/bench 复跑；未做逐规则源码全审（抽样 5 条规则 + 注册表/meta/测试）；未与 Semgrep/CodeQL 同语料对比；评分不确定性 ±0.5。 |

**最终判断**：lintsight 值得继续投入，但当前应定位为“可试点的 JS/TS 前端与后端轻量 SAST 内核”，而不是“可替代现有 JS/TS 引擎”。替代的门票不是更多规则，而是：**跨过程/跨文件数据流 + Vue/Nest 框架语义 + 逐行标注基准 + 可观测的契约与正确的增量**。
