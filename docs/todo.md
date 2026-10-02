# lintsight · M1 执行 Todo（T1.x）

> 依据：[design-m1-v0.1.md](design/design-m1-v0.1.md) §8 里程碑切片 + §9 风险与开放问题
> 分级滚动：执行级（当前在做，任务拆到可验收）→ 域级（下一个切片，任务到模块）→ 占位（远期，一行带过）
> 前序阶段：最小闭环验证（SV1~SV7）✅ 已完成，报告见 [spikes/vertical-slice-m1.md](spikes/vertical-slice-m1.md)
> 状态：进行中 · 更新：2026-09-15

## 门禁任务（不完成对应切片不得开工）✅ 2026-09-16

- [x] T1.0a **rule-sdk 接口 RFC 评审**：[rule-sdk-rfc-v0.1.md](design/rule-sdk-rfc-v0.1.md)——用户评审通过；开放问题 5 拍板 M1 形态 = 裸对象 + 测试期 definePlugin 校验（bundle 方案 M1.5）；M1 冻结面 = create + visitor
- [x] T1.0b **P0 规则清单定稿**：[p0-rules-proposal-v0.1.md](design/p0-rules-proposal-v0.1.md) v0.1①——用户评审 6 点全部实证成立并吸收（no-then-without-catch 移入映射清单；innerhtml 单 severity；4 处边界注记；sync-io 转正），定稿 26 条
- [x] T1.0c spike ③ tsgolint 实测 ✅ 2026-10-01：报告见 [spikes/tsgolint-spike3.md](spikes/tsgolint-spike3.md)。结论：type-aware 策略定案直接启用 `--type-aware`——三类存量形态全跑通（现代 tsconfig / 无 tsconfig JS 仓库 / monorepo 未 build）、开销 +23~38%、`no-misused-promises` 显式启用生效（⚠️ `--rules` 三列全空 ≠ 不可用）；TS7 移除选项（downlevelIteration/baseUrl/paths）→ tsconfig-error 诊断不阻断（桥接层须降级，别名兜底 FR-304 必要性实证）；无跨进程缓存；连带落地 T1.13（sourceCode 注释访问实证 → allowComments 选项 + RuleTester per-case options 基建）。**M1 门禁任务全清**

## S1 竖切正式化（执行级）✅ 2026-09-15

- [x] T1.1 包结构重组：拆分 `@lintsight/{cli, config-bridge, diagnostic, formatter, shared, vue-processor}` workspaces 包，spike 代码迁移（测试随包迁移）
- [x] T1.2 diagnostic 正式化：contractVersion 升 `"1"`、`owner` 字段（注册表联动）、防御归一化清单逐项单测（ruleId 归一 / filename 双候选 / 尾斜杠 / stat / 确定性排序）
- [x] T1.3 CLI 参数面补全：`--format json|text`、`--log-level`（shared logger）、错误路径禁止异常逃逸（exit 2 契约单测 ×5）
- [x] T1.4 JSON 报告 golden file 落地（CI 环境禁用 bun snapshot，改手工 golden：`test/__golden__/report-v1.json`）+ 竖切用例迁移全绿
- 验收：`bun test` 48/48 全绿；lint 0 警告；单文件二进制回归通过

## S2 config-bridge（执行级）✅ 2026-09-15

- [x] T1.5 `lintsight.config.json` schema + JSONC 解析（注释/尾逗号状态机）+ 友好错误（字段路径 + 期望值）
- [x] T1.6 翻译器：rules（`off`→`allow`、选项数组）/ overrides / ignore → `.oxlintrc`（写入 `.lintsight-cache/oxlintrc.json`，spawn 经 `--config` 传入）；pipeline 已集成（有 lintsight.config.json → 显式 config；无 → 回落 oxlint 自动发现）
- [x] T1.7 内置启用映射清单机制（`builtin-mapping.ts`，v0 = correctness 基线）+ 等价报告（✅/🔄/➖）
- [x] T1.8 oxlint overrides 语义实测：`files+rules` 覆盖**有效**、jsPlugins 绝对路径有效、规则值 `allow/error/warn`、选项数组有效 → 结论回写设计文档 v0.1①；开放问题 1 拍板「不支持通配 severity」并在 config-bridge 显式拒绝
- 验收：翻译单测全覆盖（12 例）+ overrides 实测记录进设计文档 §9

## S3 正确性规则（域级）✅ 2026-09-16

- [x] T1.9 rule-sdk 正式化 ✅ 2026-09-16：`@lintsight/rule-sdk`（defineRule/definePlugin meta 契约校验 + messageId 运行时一致性 + RuleTester 工具化）；RuleTester 与 pipeline 同款 config 链路（dogfood）；现有插件全部规则经 definePlugin 校验通过
- [x] T1.10 正确性规则全量完成 ✅ 2026-09-16：`no-async-array-method` + 剩余 9 条（floating-promise [local 预扫描启发] / swallowed-promise-error / closure-loop-var / array-map-side-effect / json-structured-clone / ignored-reduce-result / empty-promise-catch / async-constructor-call / sync-io-in-async）；每条 3 bad / 2 good 用例先行，期望位置探测校准后固化；契约测试 9 组全绿（73/73），golden 重生成；dogfood 配置启用全部 11 条
- [x] T1.11 注册表登记 + CI 校验 ✅ 2026-09-16：`lintsight-diagnostic/test/registry.test.ts` 四项校验（插件规则必须登记 / detection 与 typeRequirement 映射一致 / 防陈旧条目 / 命名空间契约）；M1 校验载体 = bun test 套件；已登记 11 条，负向验证可拦漏登记

## S4 安全语法级规则（域级，可与 S3 并行）✅ 2026-09-16

- [x] T1.12 安全 P0 规则全量完成 ✅ 2026-09-16：14 条 CWE/OWASP 对齐 checker（hardcoded-credentials 798 / unsafe-regex 1333 / prototype-pollution-syntax 1321 / child-process-nonliteral 78 / non-literal-fs-filename 22 [low 禁门禁] / non-literal-require 94 / weak-hash 327 / math-random-secret 338 / sensitive-storage 312 / innerhtml-assignment 79 / sql-concat 89 / cors-wildcard 942 / vm-dynamic-code 94 / insecure-cookie 614）；每条 3 bad / 2 good 用例先行；注册表 25 条全登记；88/88 全绿；dogfood 修复自指误报后 0 error
- [x] T1.13 `no-empty-catch` 的 `allowComments` 选项 ✅ 2026-10-01：spike ③ 实证 sourceCode 注释访问能力可用（RFC 开放问题 2 关闭）→ 选项落地（默认关闭，注释占位放行）；RuleTester 补 per-case options 基建（按选项分组叠加 oxlintrc）；选项组 fixture 移入 `fixtures/options/`（不进全量扫描面）；7/7 全绿

## S5 Vue 正式版（域级）✅ 2026-10-01

- [x] T1.14 就地临时文件约定落地 ✅ 2026-10-01：虚拟文件改写至原 .vue 同目录（`<Foo>.vue.lintsight-<pid>-<seq>.<lang>`，取代 cache 目录方案，保 import 解析上下文）；多 script 块策略 = 优先 setup、其余显式告警（同行开标签/src 外链同样显式告警，不静默漏扫）；回映射改用本次运行精确路径表；并发写冲突处理 = pid+序号隔离 + finally 只清本次文件；gitignore 规则幂等追加（`ensureGitignore`）；结论回写设计文档 v0.1②
- [x] T1.15 oxlint fix JSON 结构实测 → safe fix 逆映射回写 ✅ 2026-10-01：实测 JSON 诊断**无 fix 字段**（oxlint 1.83.0），唯一机制 = `--fix` 就地写盘 → 定案**差量行回写**（行数不变逐行 1:1 拷回，行数变化显式跳过告警）；CLI 新增 `--fix`；收敛断言进 CI（fix.test.ts：回写 → 复扫 0 诊断 → 临时文件零残留）；94/94 全绿，golden 未破坏

## S6 缓存 + 性能（域级）✅ 2026-10-01

- [x] T1.16 内容哈希缓存 ✅ 2026-10-01：`@lintsight/cli` 内 `cache.ts`（pipeline 内筛减步骤，不拆独立包）；键 = sha256(引擎指纹\|配置指纹\|规则集指纹\|文件内容哈希)——oxlint `--version` 实测指纹、jsPlugins 产物内容哈希（规则逻辑变更击穿缓存）、依赖闭包/tsconfig 成分归 M2；降级 fail-open（oxlint 不可解析 → 缓存禁用，IO 异常 → miss）；`--fix` 禁缓存读写；pipeline 不再启动清空 `.lintsight-cache`；单测 6 例（键敏感性/roundtrip/引擎漂移/命中失效/配置击穿/fix 禁用）
- [x] T1.17 hyperfine 基准 ✅ 2026-10-01：`bun run bench`（确定性万行语料 `.bench-corpus/` 100 文件×10700 行，`--no-cache` 冷扫，`--ignore-failure` 容忍 exit 1 诊断语义）；万行 <10s 硬门禁实测 **194ms**（余量 50 倍）；`scripts/bench-baseline.json` 基线（commit 溯源）+ 回退 >15% exit 1 门禁；100/100 全绿

## S7 试用与基线（域级）

- [x] T1.18 语料库 v0 接入 + 基线脚本 + 双报率 0 断言 ✅ 2026-10-01：`corpus/corpus.json` manifest（zod@v3.25.76 + dayjs@v1.11.9 锁 tag，本体浅克隆 `corpus/repos/` 已 gitignore）；`bun run corpus:check` = 全量冷扫（654 文件 / 313 诊断，自有规则命中 86）+ 双报率 0 断言（同 file+offset+length 跨引擎双 owner）+ 指纹级基线 diff（漂移 exit 1，重建显式 `--save`）；`corpus/baseline-v0.json` 入库；⚠️ `bun test` 收窄 `./packages ./scripts`（裸 bun test 子串 filter 撞 corpus 第三方测试）
- [x] T1.19 内部 ≥3 项目接入试用 + 误报标注反哺 confidence ✅ 2026-10-01（**3/3 完成，M1 验收全达成**）：
  - ✅ ① text-rpg（Next.js + Bun，57 文件）：27 条诊断（自有规则 26 条），抽验 error 级 3 真 1 误报——saves 页静默失败为真缺陷；首例误报回填（no-empty-promise-catch 写队列隔离模式，confidence high→medium，注册表同步）；no-non-literal-fs-filename 补内部 utility 噪音 pattern 标注 → **M1.5 候选已提前落地**（未导出函数参数豁免，text-rpg 复扫 11→8，残留 8 条 = path.join 派生路径复核清单，继续压缩属 M2 taint 领域）；SSE enqueue 空 catch 3 条 = allowComments 选项的典型场景
  - ✅ ② Lexio/kb-vault-platform（Vite + Bun，31 文件）：4 条 error，误报 1 条——no-hardcoded-credentials 命中 `token: 'really'`（LCS 词元测试数据）；行为优化回填：裸 token 要求值具备凭证形态（含数字/非字母字符或长度 ≥ 12）；注记：unicorn/no-new-array 对合法 DP 初始化误报（oxlint 内置，M2 接管评估对象）
  - ✅ ③ hono 后端/kb-vault-server（Hono + Prisma，39 文件）：12 条全部 no-hardcoded-credentials——2 条自指误报（ACCESS_TOKEN = 'access_token' cookie 名常量）→ 规则优化回填（值与键名 normalize 后相同 → 豁免）；1 条真问题（seed-data.ts 演示环境 admin 默认口令）；9 条测试 fixture 密码（惯例可接受，改进建议 = import SEED_PASSWORD 单一来源）
  - 注册表扩 confidence 字段（与 meta.confidence 一致性 CI 校验）——试用标注的反哺通道建成
  - 根 tsconfig.json 落地（Bun workspaces 裸名导入的 IDE paths 映射；runtime 不依赖）
  - 试用统计：3 项目 127 文件 / 43 诊断 / 误报标注 4 例 / 规则行为优化 2 次（均附契约用例）
  - M1.5 候选提前落地（2026-10-01）：no-non-literal-fs-filename 未导出函数参数豁免（bad-4 契约守住「豁免仅限参数」边界 + good-3 私有 helper/闭包场景）；⚠️ 实测 oxlint 嵌入式 runtime 不支持 { enter, exit } 对象形态 visitor（只认函数值 / ':exit' 键，1.83.0）——已写入规则注释；残留 8 条 path.join 派生路径复核清单 = M2 taint 演示场景（readdir→join→readFile 数据流判定）
  - 上游误报候选（M2 接管评估）：unicorn/no-new-array 对 `new Array<number>(n).fill(0)` 泛型+fill 合法 DP 初始化报错（Lexio lcs.ts 实测）；候选动作：oxc 仓库提 issue / M2 自研规则接管

## M2 深度分析引擎（域级 Todo · 2026-10-01 起草，design-m2 评审后升执行级）

> 依据：[requirements-v0.2.md](requirements/requirements-v0.2.md) §2.4 sidecar 双引擎 + §8.2 修订⑬ M2 内部排序（架构规则先行 → taint 竖切）+ [spikes/oxc-crate-poc.md](spikes/oxc-crate-poc.md)（spike ① 已验证 L1/L2 直连与版本锁定）。域级颗粒度：任务到模块 + 验收锚点；执行级拆解随 design-m2-v0.1 评审后滚动细化。

### T2.0 门禁任务（不完成对应切片不得开工）✅ 2026-10-01

- [x] **design-m2-v0.1.md** ✅ 2026-10-01：[design/design-m2-v0.1.md](design/design-m2-v0.1.md)——sidecar 架构 + JSON Lines 诊断协议（含 pathEvents 证据链 v0）+ 桥接解析链（OXLINT_ENGINE_BIN → node_modules → cargo 产物，fail-open 降级）+ 双报消解 supersedes 机制 + M2-DR1~5（协议/传播模型/降级/分发/函数表治理，均含备选与否决理由）。待用户评审
- [x] spike ⑤ **taint 竖切预演** ✅ 2026-10-01：报告见 [spikes/taint-poc-spike5.md](spikes/taint-poc-spike5.md)；代码 `crates/oxc-poc/src/taint.rs` + `taint-fixture.ts`。三场景全过：参数→join→sink 命中、basename sanitizer 豁免、readdir→for-of→sink 循环回边（28 轮不动点收敛，sink offset 去重）。教训回填 design-m2：source/sink 函数表不得交叠（登记期校验）、for-of 迭代变量必须显式处理、API 修正（BindingPattern 是 enum 无 Kind 包装）
- 设计评审通过后 T2.1~T2.6 升执行级开工

### T2.1 Rust 工程脚手架（执行级锚点：`cargo test` + bun 侧 spawn 联通）✅ 2026-10-01 (fa36df7)

- [x] `crates/lintsight-engine` 独立 cargo 工程：JSON Lines 协议（stdin files → stdout diagnostic/summary，exit 2 fatal 语义）+ no-eval 联通验证规则；oxc `=0.150.0` 精确锁
- [x] sidecar 桥接 `engine-bridge.ts`：二进制解析链（OXLINT_ENGINE_BIN → node_modules/.bin → cargo 产物）+ spawn 桥接；引擎缺失 = 正常形态、启动/协议失败 = degraded 降级纯 M1（M2-DR3 fail-open）；降级路径 ×3 + spawn 联通测试
- [x] 统一诊断流：Owner 三值扩展（+lintsight-engine）+ deriveOwner 命名空间路由；引擎诊断经 missMap 回映射并入统一模型（contractVersion=1）；引擎二进制内容哈希并入缓存引擎指纹（升级击穿缓存）
- 附带修复：build-rules 产物补过 oxfmt（test 重建与 format 来回翻转的漂移根因）

### T2.2 L1/L2 消费层（基建白捡区，spike ① 代码产品化）✅ 2026-10-01 (7f5ce97)

- [x] FileContext 消费面（`context.rs`）：parse→semantic（with_build_nodes+with_cfg，cfg feature 回归哨兵测试）+ LineMap + ref2sym 反向表 + AST→CFG 块分组（taint 挂载点）+ source_text；scope-and-run（`with_context`）= oxc 惯用 arena 模式
- [x] EngineRule trait + registry() 登记处（规则唯一接入面，铁律 2 的 Rust 轨道对应物）；Summary.rules 动态生成
- [x] 内存纪律：Allocator 移入文件循环（每文件独立 arena）；实测峰值 ≈ 最大单文件与批大小无关——92k 行单文件 98MB / 200 文件 10 万行 4.3MB / 400 文件 20 万行 4.1MB（批翻倍 RSS 持平）

### T2.3 taint 竖切（首切片，单文件，价值验证优先于覆盖面）✅ 2026-10-01 (c93b3f4)

- [x] taint 引擎产品化（`taint.rs`）：CFG 块前向 worklist + SymbolId 污染集 + 证据链伴随传播；函数表注册表驱动（M2-DR5）+ 登记期两两交叠校验；传播面 = join/赋值/for-of/索引访问/模板串/拼接，sanitizer = path.basename（混合实参保留清洗痕迹）
- [x] no-path-traversal（CWE-22 数据流版）+ 协议可选 pathEvents（source→propagation*→[sanitizer]→sink，skip_serializing_if 向后兼容）；bridge 透传类型（contract v1 不变，合并层 T2.5 接入）
- [x] 验收：text-rpg db.ts readdir→join→readFileSync 两条流命中且链完整（L159/L188），字面量 join 未误报；basename sanitizer 流零误报（契约用例）；corpus 基线一致（no-eval/no-path-traversal 语料零命中）；CLI 端到端 owner=lintsight-engine 并入报告
- v0 边界（已文档化）：命名导入别名、箭头函数参数污点、跨文件/跨过程传播归 M3；函数参数不作 source（真实项目误报风暴，spike ⑤ 保守近似不产品化）

### T2.4 架构规则 ✅ 2026-10-01 (713764d)

- [x] arch-boundaries：词法 import 图（import/export-from[0.150 独立节点 ExportFromDeclaration]/动态 import/require 字面量）+ 段级 glob（自实现零新依赖）+ zone 首匹配；语义 = 同 zone 内聚恒允许、跨 zone 必须命中 allow；span = import source 字面量
- [x] 配置面：lintsight.config.json `arch.zones`（name/match/allow，config-bridge 字段路径友好校验）→ generateOxlintrc 透传 → stdin 下发引擎（arch 缺省规则不注册，Summary.rules 动态反映）；arch 变更经 configFp 自动击穿缓存
- [x] dogfood：rules-core 零依赖边界 + cli 依赖面（58 文件零违例）；顺带 no-empty-promise-catch dogfood severity error→warn（medium 置信规则策略，best-effort 清理 FP 模式入册）
- 误报复核清单（v0 边界，arch.rs 模块文档 + 此处备案）：① 命名别名（@scope/pkg、tsconfig paths）按裸说明符跳过（漏报不误报）② require/动态 import 仅字面量 ③ 扩展名省略为词法 normalize（不 stat 文件系统）④ zone 首匹配顺序敏感

### T2.5 双引擎合并与平台契约 ✅ 2026-10-01 (9645831)

- [x] 注册表：lintsight-engine 条目入册 + supersedes 消解对登记（仅 engine 条目可用，目标必须是在册 lintsight-js 规则，CI 校验锁定）；no-path-traversal ⊃ no-non-literal-fs-filename
- [x] suppressSuperseded：数据流版命中行抑制同文件同行语法级版本；行级口径（JS/引擎锚点 span 不同实测列差 4，span 精确匹配无效）；纯函数保序；端到端测试（命中行抑制/无命中行保留）
- [x] type-aware 编排（spike ③ 结论落地）：typescript(tsconfig-error) 归一化降级 info（不进 exit code）；SARIF 2.1.0 报告器（--format sarif，level 映射 + rules 去重排序 + schema 结构测试）
- [x] 验收：corpus 三 owner 双报率 0；SARIF schema 快照测试
- [x] ~~剩余~~ **M2.5 收口完成 ✅ 2026-10-01**（typeAware 编排 + FR-304 别名兜底落地）：
  - **typeAware 子编排**：lintsight.config.json `typeAware: boolean` 显式开关（FR-305）→ oxlint spawn 追加 `--type-aware`；tsgolint 缺失/不可用自动降级重试纯 M1 并 warn 提示（fail-open 同纪律）；缓存经 configFp（含 config 文件 hash）自动击穿
  - **FR-304 别名解析兜底**：pipeline 读 cwd/tsconfig.json（JSONC，含 baseUrl 相对解析）→ best-match 排序（pattern 固定前缀长者优先）→ stdin 下发引擎 → arch-boundaries 裸说明符走别名解析后 zone 匹配；未命中维持跳过（漏报不误报）。边界：只读根 tsconfig（嵌套/per-package 不处理）；package exports 别名仍跳过
  - **typeAware dogfood 试点结论**：抓到 engine-bridge 2 条 `no-floating-promises` 真问题（`stdin.write/end` 在 tsgolint 类型视角为 floating——M1 语法层盲区，`void` 显式标注已修）；**dogfood 不默认开启**——golden/corpus 契约稳定性不绑定 tsgolint 行为（版本升级即诊断面漂移），业务项目按需开启
  - **连带修复**：cache.jsPluginPaths 改 JSONC 解析（手写 .oxlintrc.json 带注释曾静默失败 → 插件指纹成分缺失）
  - 测试：cargo 17/17（alias 解析/zone 命中/无映射回归哨兵）+ bun 130/130（typeAware 校验/resolveTsPaths fail-open/别名端到端）+ corpus 基线一致

### T2.6 性能验收（§3.5 预算）✅ 2026-10-01

- [x] rayon 文件级并行（par_iter 保序 collect = 串行一致性，EngineRule: Send+Sync；确定性回归测试 ×12 文件）；默认全核（--concurrency 可调未做，按需后补）
- [x] bench 门禁扩展到引擎：hyperfine 引擎直测（stdin 重定向方案，本机 hyperfine 不支持 --stdin 参数）；硬门禁 = 万行 <1s + NFR-1 吞吐报告 + 回退 >15% 双门禁（CLI/引擎分离基线字段 engineMeanMs）
- [x] 实测：引擎直测 5.9ms/万行 = **181 万 LOC/s（NFR-1 预算 15 万的 12 倍）**；10 万行 20ms 墙钟（5 线程 512% CPU）；峰值 RSS 12.4MB（≈线程数×单文件，内存纪律并行下保持）；CLI 全管线 194ms（与 M1 基线持平）

**M2 执行切片 T2.1~T2.6 全部完成（2026-10-01），M2.5 收口（typeAware 编排 + FR-304 别名兜底）完成。**

### M2.6 安全规则批次启动 + 企业级语料扩容 ✅ 2026-10-01

- [x] **taint source 模型扩展**（FR-303 后端前置）：source 表新增成员表达式形态（`member_sources`）——`req.query/body/params/headers/cookies` 访问即污染，链上任意相邻段对命中（`req.query.id` → (req,query)）；同名调用形态（Hono `c.req.query()`）同样污染；裸标识符 sink 支持（`import { exec } from 'node:child_process'` 解构形态，obj=""约定）；五表交叠校验扩展。证据链增强：模板串/字符串拼接记 propagation 事件（template-literal/concat）
- [x] **no-command-injection**（CWE-78，FR-303 硬门槛第 2 条）：Express/Koa/Hono 常见 source 形态 ×12 → `exec/execSync/spawn/spawnSync`（cp/child_process 命名空间 + 裸调用）×12；v0 无 sanitizer 表（shell 转义不可靠，正确做法 execFile + 参数数组）；cargo 用例 ×3（Express/Hono/负面）
- [x] **corpus 扩容 express@4.21.2**（企业级后端语料）：基线 654→806 文件 / 310→590 诊断；构成分析——+213 unused-vars 与 +6 credentials 来自 test/；**no-insecure-cookie 20/24 集中在 res.cookie.js = 库 API 实现体口径噪音**（库代码 Set-Cookie 是 API 本体，已知模式）；引擎 0 命中符合预期（框架库无 req→exec 应用流，taint 价值面在应用层）
- [x] 教训：express tag 不带 v 前缀（ls-remote 先行验证 tag 格式）
- 待办延伸：no-ssrf / no-prototype-pollution-merge（M2.6 后续批次）；express 应用层样例（examples/ 目录）可作 taint 场景补充验证

### M2.6 后续批次：no-ssrf + no-prototype-pollution-merge ✅ 2026-10-02

- [x] **no-ssrf**（CWE-918，FR-303 stretch）：sink = fetch（裸调用）+ axios get/post/put/delete/request + http/https get/request ×10；member source 复用（req.* / request.* / ctx.*）×9；URL 在 options 对象内的形态（axios({url})）v0 不识别（复核清单）
- [x] **no-prototype-pollution-merge**（CWE-1321，FR-303 硬门槛第 3 条）：**sink_arg_index=1 模型**（Object.assign(target, 源) 污染点在第二参数，每规则可配参数位）；sink = Object.assign + lodash merge/mergeWith/defaultsDeep/set（`_` 与 `lodash` 双命名空间）×9；与 M1 语法版分工（语法版抓字面量 `__proto__` 键，taint 版抓动态可控源，互补不重叠不登记 supersedes）
- [x] FR-303 硬门槛 3 条 + stretch 2 条全部落地（path-traversal ✅ / command-injection ✅ / prototype-pollution-merge ✅ / ssrf ✅ + sql-concat 保留 M1 语法级——模板串形态已覆盖主要面）
- [x] corpus 基线一致（express 全仓对新规则零命中——框架库无应用层污点流，符合预期）；cargo 25/25（ssrf ×2 + proto ×3 + 表校验）
- 引擎规则面终态：lintsight-engine/{no-eval, no-path-traversal, no-command-injection, no-ssrf, no-prototype-pollution-merge, arch-boundaries} ×6
- [x] unicorn/no-new-array 上游 issue 已提交 ✅ 2026-10-02：[oxc-project/oxc#27280](https://github.com/oxc-project/oxc/issues/27280)——`new Array<number>(n).fill(0)` 合法 DP 初始化误报（Lexio lcs.ts 实测复现）；定位为 fill 链豁免请求（非移植 bug：上游 eslint-plugin-unicorn 文档亦无 carve-out），文中含 `Array(n).fill(0)` 无 new 变体不报的规则一致性论证
- [x] **corpus 二批扩容（安全测试库）✅ 2026-10-02**：juice-shop@v19.2.1 + nodegoat@v1.4 + ghost@v5.130.6——基线 806→**5596 文件** / 590→**4890 诊断**：
  - **召回初步命中**：no-ssrf 命中 juice-shop 官方 SSRF 埋洞文件（profileImageUrlUpload.ts#L24）；no-path-traversal 命中 vulnCodeFixes.ts；no-eval ×6 命中 juice-shop（captcha/userProfile）与 nodegoat（contributions ×3）的 eval 埋洞——埋洞对照召回验证的起点，完整对照清单待人工逐挑战核对
  - **连带修复：normalizeRuleId 无 code 诊断细分**——36 条「插件崩溃」实为 **oxc parse error 误归类**（codefixes 故意残缺片段 / ghost .cjs 的 CJS-ESM 混用）；拆分 `internal/parse-error`（扫描对象问题）与 `internal/oxlint-plugin-error`（引擎侧缺陷，message 含 "Error running JS plugin" 标记），插件健壮性兜底语义恢复准确
  - 构成速览：no-hardcoded-credentials 539（ghost/juice-shop test+data 大头）、no-floating-promise 272、no-innerhtml-assignment 70（juice-shop XSS 埋洞）、no-sensitive-storage 17（localStorage 埋洞）

### T1.19 补完：Vue 真实项目试用 + 三项目 M2 复扫 ✅ 2026-10-01

- [x] ④ code-viewer（Vue 3.5 + Vite 组件库，pnpm，lib 组件源 / src 示例 app 双入口，43 文件含 14 .vue）：
  - **自有规则 2 条真缺陷**（lib/core/code-viewer.vue#L97 同一调用双命中）：`props.plugins.map(async (plugin) => await pluginManager.registerPlugin(plugin))`——no-array-map-side-effect（map 结果丢弃纯副作用）+ no-async-array-method（async 回调 Promise 数组被弃 → registerPlugin 异常 unhandled rejection，且 setup 顶层后续代码不等待注册完成）
  - **.vue 虚拟块管线实战验证**：诊断行号精确回映射到 SFC 真实行（L97/L62/L72），就地临时文件机制在 pnpm + 双入口形态下工作正常
  - 口径噪音：no-useless-escape ×250 全部来自 `src/**/token/*.ts` 语法高亮正则测试语料（有意转义）；no-unused-vars ×64（demo 示例 + lib 重构残留）；docs/ 为 vite 构建产物不应纳入扫描面
- [x] 三项目 M2 复扫（引擎 no-path-traversal + supersedes 消解生效验证）：
  - text-rpg（57 文件 24 条，T1.19 时 27）：**no-path-traversal ×2 命中 db.ts L159/L188（readdir→join→readFile）且同位置语法级 no-non-literal-fs-filename 被 supersedes 抑制**——双引擎消解在生产项目端到端生效；no-floating-promise ×2 落在 T1.19 已知的 saves 页真缺陷区域
  - Lexio（31 文件 3 条）：全部 unicorn（lcs.ts#L17 no-new-array 即上游 issue 场景）；**裸 token 优化后自有规则 0 误报**（T1.19 #2 优化回归通过）
  - hono（39 文件 10 条）：全部 no-hardcoded-credentials（1 真 seed-data.ts + 9 测试 fixture 惯例）；自指豁免后 ACCESS_TOKEN 零误报 ✓
  - 四项目结论：**M2 引擎能力（taint 数据流 + 双报消解）在真实项目形态下工作正常，自有规则误报率随三轮反哺持续下降（Lexio/hono 本轮零误报）**

## 远期占位（M3+ / 择机）

- `lintsight migrate --from eslint`（FR-502）
- LSP（M3）/ 远端缓存 / 分布式分片（千万行场景）
- 上游反馈：unicorn/no-new-array 对泛型+fill 合法初始化的误报（oxc 仓库提 issue）
