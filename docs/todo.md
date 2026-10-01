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

## 远期占位（M2 输入，M1 不做）

- [x] spike ① oxc crate 直连 PoC ✅ 2026-10-01（提前完成）：报告见 [spikes/oxc-crate-poc.md](spikes/oxc-crate-poc.md)；PoC 工程 `crates/oxc-poc/`。结论：M2 路线可行——L1/L2（semantic/cfg）GA 免建、101k 行 29ms（3.49M LOC/s，超 NFR-1 预算 23 倍）、AST↔CFG 桥实证、版本锁 `=0.150.0`（对齐 oxlint 1.83.0）+ cargo-deny 门禁跑通；DFG/taint 为自建区，挂载点 = `SymbolId + cfg_id`
- SARIF / 平台路径契约（附录 C）/ `lintsight migrate --from eslint`
- LSP（M3）
