# lintsight · M1 执行 Todo（T1.x）

> 依据：[design-m1-v0.1.md](design/design-m1-v0.1.md) §8 里程碑切片 + §9 风险与开放问题
> 分级滚动：执行级（当前在做，任务拆到可验收）→ 域级（下一个切片，任务到模块）→ 占位（远期，一行带过）
> 前序阶段：最小闭环验证（SV1~SV7）✅ 已完成，报告见 [spikes/vertical-slice-m1.md](spikes/vertical-slice-m1.md)
> 状态：进行中 · 更新：2026-09-15

## 门禁任务（不完成对应切片不得开工）

- [ ] T1.0a **rule-sdk 接口 RFC 评审**：`defineRule` / RuleTester / meta 契约类型面冻结（对外承诺，最难改）——S3 开工前完成
- [ ] T1.0b **P0 规则清单评审定稿**（M0 交付物）：差异化 25~30 条 + 内置启用映射清单初版——S3 开工前完成
- [ ] T1.0c spike ③ tsgolint 实测（可并行，不阻塞 S1~S5；M1 验收中 type-aware 相关承诺以其结论为前提）

## S1 竖切正式化（执行级）

- [ ] T1.1 包结构重组：拆分 `@lintsight/{cli, diagnostic, vue-processor}` workspaces 包，spike 代码迁移（对应设计 §4.1/4.4）
- [ ] T1.2 diagnostic 正式化：contractVersion 升 `"1"`、`owner` 字段（注册表联动）、防御归一化清单逐项单测（ruleId 归一 / filename 双候选 / 尾斜杠 / stat / 确定性排序）
- [ ] T1.3 CLI 参数面补全：`--format json|text`、`--log-level`、错误路径禁止异常逃逸（exit 2 契约单测）
- [ ] T1.4 JSON 报告快照测试落地 + 竖切 13 例迁移全绿
- 验收：`bun test` 全绿迁移 + 新增防御项单测；快照变更走显式 review

## S2 config-bridge（执行级）

- [ ] T1.5 `lintsight.config.json` schema + JSONC 解析 + 友好错误（列名 + 期望值）
- [ ] T1.6 翻译器：rules / overrides / ignore → `.oxlintrc`（写入 `.lintsight-cache/`，spawn 经 `--config` 传入）
- [ ] T1.7 内置启用映射清单机制（`builtin-mapping.ts`）+ 等价报告（✅/🔄/➖）
- [ ] T1.8 oxlint overrides 语义实测核对（设计 §9 风险项：不通过则 M1 收窄 overrides 支持；连带拍板通配 severity 开放问题）
- 验收：翻译单测全覆盖 + overrides 实测记录进设计文档

## S3 正确性规则 ~10 条（域级，等 T1.0a/b 门）

- [ ] T1.9 rule-sdk 正式化：`defineRule`（meta 契约校验）+ RuleTester 工具化（spawn 批扫 + 按文件断言位置/fix）
- [ ] T1.10 正确性 P0 规则逐条开发（P0 清单评审后逐条立任务；每条 ≥3 bad / ≥2 good / safe case / 边界矩阵）
- [ ] T1.11 每条规则注册表登记（ruleId/owner/检测层/状态）+ CI 校验

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
