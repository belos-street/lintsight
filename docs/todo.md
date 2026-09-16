# lintsight · M1 执行 Todo（T1.x）

> 依据：[design-m1-v0.1.md](design/design-m1-v0.1.md) §8 里程碑切片 + §9 风险与开放问题
> 分级滚动：执行级（当前在做，任务拆到可验收）→ 域级（下一个切片，任务到模块）→ 占位（远期，一行带过）
> 前序阶段：最小闭环验证（SV1~SV7）✅ 已完成，报告见 [spikes/vertical-slice-m1.md](spikes/vertical-slice-m1.md)
> 状态：进行中 · 更新：2026-09-15

## 门禁任务（不完成对应切片不得开工）✅ 2026-09-16

- [x] T1.0a **rule-sdk 接口 RFC 评审**：[rule-sdk-rfc-v0.1.md](design/rule-sdk-rfc-v0.1.md)——用户评审通过；开放问题 5 拍板 M1 形态 = 裸对象 + 测试期 definePlugin 校验（bundle 方案 M1.5）；M1 冻结面 = create + visitor
- [x] T1.0b **P0 规则清单定稿**：[p0-rules-proposal-v0.1.md](design/p0-rules-proposal-v0.1.md) v0.1①——用户评审 6 点全部实证成立并吸收（no-then-without-catch 移入映射清单；innerhtml 单 severity；4 处边界注记；sync-io 转正），定稿 26 条
- [ ] T1.0c spike ③ tsgolint 实测（可并行，不阻塞 S1~S5；M1 验收中 type-aware 相关承诺以其结论为前提；连带确认 typescript/no-misused-promises 生效性）

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

## S3 正确性规则（域级，门禁已过 → 执行中）

- [x] T1.9 rule-sdk 正式化 ✅ 2026-09-16：`@lintsight/rule-sdk`（defineRule/definePlugin meta 契约校验 + messageId 运行时一致性 + RuleTester 工具化）；RuleTester 与 pipeline 同款 config 链路（dogfood）；现有插件全部规则经 definePlugin 校验通过
- [x] T1.10 正确性规则全量完成 ✅ 2026-09-16：`no-async-array-method` + 剩余 9 条（floating-promise [local 预扫描启发] / swallowed-promise-error / closure-loop-var / array-map-side-effect / json-structured-clone / ignored-reduce-result / empty-promise-catch / async-constructor-call / sync-io-in-async）；每条 3 bad / 2 good 用例先行，期望位置探测校准后固化；契约测试 9 组全绿（73/73），golden 重生成；dogfood 配置启用全部 11 条
- [x] T1.11 注册表登记 + CI 校验 ✅ 2026-09-16：`lintsight-diagnostic/test/registry.test.ts` 四项校验（插件规则必须登记 / detection 与 typeRequirement 映射一致 / 防陈旧条目 / 命名空间契约）；M1 校验载体 = bun test 套件；已登记 11 条，负向验证可拦漏登记

## S4 安全语法级规则 ~14 条（域级，可与 S3 并行）

- [ ] T1.12 安全 P0 规则逐条开发（同 S3 标准，cwe/owasp tags 逐条核定）
- [ ] T1.13 `no-empty-catch` 的 `allowComments` 选项随批评审定案（spike 遗留开放问题）

## S5 Vue 正式版（域级）

- [ ] T1.14 就地临时文件约定落地（保 import 解析上下文，§11.2）+ 多 script 块策略
- [ ] T1.15 oxlint fix JSON 结构实测 → safe fix 逆映射回写（可行性实测后再承诺，spike 未覆盖）

## S6 缓存 + 性能（占位）

- [ ] T1.16 内容哈希缓存（键 = 文件内容 + 规则集 + 配置 + 引擎版本指纹）
- [ ] T1.17 hyperfine 基准脚本 + 万行库 <10s 校准 + 回退 >15% 门禁

## S7 试用与基线（占位）

- [ ] T1.18 语料库 v0 接入（zod/dayjs 级）+ 基线脚本 + 双报率 0 断言
- [ ] T1.19 内部 ≥3 项目接入试用 + 误报标注反哺 confidence

## 远期占位（M2 输入，M1 不做）

- spike ① oxc crate 直连 PoC（M2 路线，可提前并行）
- SARIF / 平台路径契约（附录 C）/ `lintsight migrate --from eslint`
- LSP（M3）
