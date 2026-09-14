# 决策记录（DR-1~7 全量沉淀）

> 与 requirements-v0.1.md 的 DR 表一一对应；本文记录表格放不下的**上下文、完整理由与后果**。状态标注：定案 / 已关闭 / 待验证（含验证任务编号）。

## DR-1 · M1 = oxlint 基座 + JS 薄封装

- **状态**：定案（2026-09-14，设计修订①）
- **决策**：M1 不自建 JS 内核。oxlint（865+ 内置规则，2026-09 核实）承担解析/调度/并行/内置规则宿主，自有规则走 oxlint JS Plugins（ESLint v9 兼容 API）；Node 侧只做薄封装：配置翻译（config-bridge）、Vue 预处理（vue-processor）、诊断桥接（diagnostic-bridge）。
- **上下文**：初稿曾画过"Node + Babel 自建引擎"草图（旧 §11），评审发现它与 §2.1 的 oxlint 基座路线矛盾。二选一时定 oxlint：自建 Node 引擎重复造轮子，且"白捡 865+ 规则"的账最划算——M1 差异化规则全部是 none/local 检测层，没有一条需要自建引擎能力。
- **否决项**：自建 Node/JS 引擎——重复实现 oxlint 已维护多年的文件收集/调度/规则面；三个月换来一个规则面更小的半成品。
- **后果/约束**：JS Plugins 处于 alpha（风险清单跟踪，锁版本 + 语料库 diff 门禁）；JS Plugins 不支持 processor/`.vue`，Vue 必须自建预处理（→ DR-5）。
- **关联**：FR-201/202、T0.4、oxc-toolchain skill

## DR-2 · M2 = Rust 深度分析引擎（sidecar 双引擎）

- **状态**：定案（设计修订①）；是否整体收编 oxlint 推迟 M3 后按维护成本再评估
- **决策**：M2 基于 oxc crates（parser/semantic/cfg 进程内直连）自建**深度分析引擎**，在其上自建 def-use/DFG/taint；以 sidecar 形态与 oxlint 并行、诊断在报告层合并。**不重建 oxlint 的规则调度与嵌入式 JS runtime**——oxlint 继续当语法级规则宿主。
- **上下文**：v0.1 初稿是"M2 整体重建 Rust 内核"。评审算清四笔账后改为 sidecar：① 能力账——M1 规则全是 none/local，JS Plugins 边界够用；② 时间账——全自建先要重写文件收集/调度/几百条语法规则，4 个月排期里 taint 反而没时间做；③ 交付账——M1 产出的指纹/契约/语料库/rule-sdk 全部被 M2 复用；④ 风险账——4~6 人、1~2 编译器背景，全自建把进度堵死在关键人身上。直接自建仅在"≥3 名编译器工程师 + 无半年平台交付压力"时更优（§0 决策变量）。
- **否决项**：整体收编 oxlint 重建全功能内核（M3 后复审）；跳过 M1 直接自建（同上四笔账）。
- **后果/约束**：深度规则必须 Rust native（JS 轨道拿不到 IR 全量 API）；两引擎诊断合并需要消解层（→ §3.6、FR-407）。
- **关联**：FR-301~304、铁律 1/2、lessons「跳过 CFG 反模式」

## DR-3 · 语言与运行时：Rust 直连 + 规则双轨

- **状态**：定案（初稿即定，评审未动摇）
- **决策**：深度引擎用 Rust（唯一能库级消费 OXC 的语言：arena 零拷贝、进程内直连）；规则层双轨——语法级 JS（ESLint 兼容 API）、深度级 Rust（引擎 IR API）。规则代码禁止直接依赖任何具体 parser 的 AST 类型。
- **上下文**：OXC 无 Go binding（crate 重度依赖 arena/lifetime，cgo 包装不现实）、无 Node 库级 binding；纯 Node 无法消费 oxc crates。AST 抽象层（ESTree 兼容）会丢掉 OXC 强类型 AST 的编译期保证，评审后选择"API 面解耦"而非"AST 统一"。
- **否决项**：Go 内核（无 binding，只能 IPC，两头不占）；WASM（M3 非主线）。
- **后果/约束**：两轨共用同一诊断模型与报告层；ruleId 物理 id 统一 `lintsight/<rule-name>`（JS 轨道由插件名派生，meta 不写 id；`RuleMeta.id` 仅 Rust 轨道/SDK 需要）。
- **关联**：铁律 2、rule-authoring skill

## DR-4 · 类型感知：tsgolint 首选，不自实现 type-aware

- **状态**：定案（修订②收敛策略）；spike ③ 验证中（T0.5）
- **决策**：type-aware 规则**直接启用 oxlint --type-aware（tsgolint，stable v7，59/61 条规则）**，深度引擎不自实现任何 `program` 级规则；tsc Program 仅兜底。tsgolint 要求 TS 7.0+ 且不支持 `baseUrl`——存量项目引擎侧别名解析兜底（供 import 图/架构规则），type-aware 层自动降级 `local` 并提示。
- **上下文**：FR-305 初稿曾计划深度引擎自实现 floating-promise/unsafe-any——评审指出这两条与 `oxlint --type-aware` 自带规则**完全重叠**，自实现工作量差一个量级且精度必然更差（tsgolint 背后是真实 TS 编译器）。
- **否决项**：深度引擎自实现 type-aware 规则；自建轻量类型推导（覆盖低，仅无 tsconfig 场景降级用）。
- **后果/约束**：`typeRequirement=program` 的语义 = "映射到 --type-aware 规则集"；存量 `baseUrl+paths` 项目需推动迁移 paths-only（风险清单跟踪）；spike ③ 必须实测类型事实传输/延迟/缓存。
- **关联**：FR-305、T0.5、铁律 3

## DR-5 · Vue：自建 VueProcessor

- **状态**：定案；spike ② 验证中（T0.4）
- **决策**：自建 VueProcessor——SFC 拆虚拟块喂入 oxlint（就地临时文件约定：保持原 `.vue` 路径上下文以正确解析 import、并发写冲突处理、临时文件 gitignore 规则）、诊断位置回映射、safe fix 区间逆映射回写。script 块 M1，template 表达式 M2。
- **上下文**：oxlint 没有 ESLint 式 processor 扩展点，JS Plugins 官方明确 `.vue` 为 "can't do yet"；而公司主栈是 Vue，SFC 支持是 MVP 硬性 P0。生态只有 vize bridge（个人项目）可参考。
- **否决项**：依赖 vize bridge 作主方案（单点依赖上游个人项目，仅作 spike 参考）。
- **后果/约束**：虚拟块与原文件的映射链路是 M1 最脆的一环——位置错位、fix 逆映射、import 解析上下文三件事都必须在 spike ② 出 demo 才准开工。
- **关联**：FR-103/206、T0.4、铁律 4

## DR-6 · 契约先行（指纹 + 附录 C 平台契约）

- **状态**：定案（修订②/③两轮加严）
- **决策**：① 诊断**指纹 M1 口径 = hash(ruleId + 文件路径 + span + messageId)**——用 messageId 而非消息文案，改文案不炸历史指纹；messageId 增删/改名视为 breaking 走显式评审；语义位置锚点待 spike ④ 验证后启用。② 平台「路径跟踪」契约（附录 C）带 **contractVersion**，line/column/range 锁字符串类型，formatter 快照测试锁定。③ 消解模型：规则注册表（ruleId/owner/检测层/状态）+ 同名升级即换宿主（retired）+ **跨名接管对**（如 `lintsight/no-floating-promise` → `typescript/no-floating-promises`，聚合层视为同 ruleId 语义去重）。
- **上下文**：附录 C 是对平台前端的**反向对齐**契约（bug-trace 面板已存在），先冻结引擎输出格式，M2 taint 竖切可直接在现有 UI 渲染，对接零返工。指纹若含消息文案，改一条规则文案 = 全量历史指纹失效 = 平台复核流与抑制登记全断（第三轮评审指出）。跨名接管是第三轮评审发现的消解缺口：不同 ruleId 同 span 不合并 + type-aware 接管 = M2 必然双报。
- **否决项**：先做引擎后补契约；指纹含消息模板文本；仅支持同名升级（覆盖不了跨名接管）。
- **后果/约束**：messageId 是对外稳定 API（breaking 走评审）；契约字段变更必须递增 contractVersion；语料库断言双报率 0（同名 + 接管对双覆盖，FR-407）。
- **关联**：FR-401/404/407、spike ④、铁律 5/7

## DR-7 · 封装层运行时与分发：Bun 绑死

- **状态**：定案（设计修订④/需求修订③）；**前提 = T0.13 验证通过**
- **决策**：封装层（cli/config-bridge/vue-processor/diagnostic-bridge/formatter）运行时绑死 Bun——bun install/workspaces + bun.lock 提交、**全面采用 Bun 专有 API**（Bun.file/Bun.Glob 等，不追求 Node 兼容）、`bun build --compile` 单文件二进制分发（业务侧零依赖安装，内嵌 runtime）、bun test 承载 RuleTester 与 CI。
- **上下文**：脚手架未搭，切换成本≈0；bun-project-conventions（个人约定）默认 Bun；compile 单文件让业务侧无感且启动快（利于本地交互目标）；Bun 原生跑 TS 使 TS 配置文件从 M3 提前到 M2 评估。用户拍板两个取舍：分发 = 单文件二进制（否决"npm 包双运行时"与"强制装 Bun"）；API = 全面 Bun 专有（否决"核心包 node: 前缀双栈兼容"）。
- **否决项**：双栈兼容（node: 前缀纪律）——牺牲 Bun 内置能力换部署兼容，用户明确不要；要求业务侧装 Bun——采用率阻力与 NFR 冲突；Node 运行时。
- **后果/约束**：**平台长驻 worker 服务器必须部署标准化 Bun 版本**（FR-503）——这是绑死的唯一真实代价面；T0.13 必须验证：oxlint bin launcher 在 Bun 下 spawn、compile 模式平台二进制路径解析（darwin+linux）、@vue/compiler-sfc 兼容、Bun workspace + changesets 配合、bun test × RuleTester。任一失败 → 分发形态回退 npm 包双运行时，DR-7 重审。
- **关联**：铁律 8、NFR-3、FR-503/704、T0.10/T0.13
