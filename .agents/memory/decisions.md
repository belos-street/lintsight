# 决策记录（Decisions Log）

> 本文件记录已敲定、需长期遵守的技术与流程决策；LLM 承接任务前先读，做出新决策时追加。
> 只追加不覆盖，编号递增；格式：结论 / 理由 / Supersedes（可选）/ 日期。被替代的旧决策末尾追加 `> 已被 Dn 替代`。

## D1 · AI 协作体系由 ai-collab-system-bootstrap 注入

- **结论**：`.agents/rules`、`.agents/workflows`、`docs/changes` 模板按 `ai-collab-system-bootstrap` 方法论落地，并按本仓结构适配。
- **理由**：保留体系来源与初始版本，便于回溯；后续在本仓本地演进。
- **来源**：外部 skill-kit `ai-collab-system-bootstrap`（未拷贝该 skill 到本仓）。
- **日期**：2026-10

## D2 · AI 配置目录统一为 `.agents/`

- **结论**：`.agents/` 下放 `rules/`、`workflows/`、`skills/`、`memory/`；规则、工作流、技能、决策各归其位。
- **理由**：跨工具通用、可移植；避免工具私有目录分裂。
- **日期**：2026-10

## D3 · 项目文档统一放 `docs/`，不新建 `doc/`

- **结论**：沿用本仓既有 `docs/requirements`、`docs/design`、`docs/spikes`、`docs/upgrade`、`docs/changes`；不引入参考体系的 `doc/` 双目录。
- **理由**：现有文档已版本化且有索引；新建 `doc/` 会造成两份事实源。
- **日期**：2026-10

## D4 · 本仓只做 JS/TS 引擎

- **结论**：任务、报告/缺陷上传、基线/抑制、AI 研判、CI/CD、策略中心等平台能力由 `scanner` CLI 或平台二次封装，禁止塞进引擎。
- **理由**：保持单一职责、可替换性与 fail-open 边界；详见 `.agents/memory/README.md`。
- **日期**：2026-10

## D5 · 升级计划与执行清单的单一事实源

- **结论**：`docs/upgrade/v0.1/upgrade-plan.md` 是范围/决策/验收的唯一事实源；`execution-todo.md` 只记录状态与证据；`review-report-v0.1.md` 只作评审快照。
- **理由**：避免计划、清单、评审报告三处漂移。
- **日期**：2026-10

## D6 · 规则文案/messageId/指纹变更视为 breaking

- **结论**：规则 `messages` 文案、messageId、ruleId、检测行为变化必须显式评审；fixtures 是契约，改实现不改用例 = 没改对。
- **理由**：指纹参与平台历史对比与抑制管理；静默变更会破坏缺陷连续性。
- **日期**：2026-10

## D7 · M4 只做 P0；G5/G10 移至 M5

- **结论**：M4 仅 P0；G5/G10 移至 M5。具体 G-ID 清单以 `upgrade-plan.md` §7/§8 与 `execution-todo.md` 为准，本日志不复制。
- **理由**：M4 是可集成 + 前端语义 + 评估闭环；资源上限与 Vue fixture 不阻塞收口。
- **日期**：2026-10

## D8 · 代码改动走 dev 分支与原子提交

- **结论**：不直接推送 `main`；从本地 `main` 切 dev 分支，按原子单元提交并推送，PR 评审后合并。
- **理由**：保护主线；便于逐提交回滚与评审。
- **日期**：2026-10

## D9 · 运行时与工具链锁定

- **结论**：运行时绑死 Bun；oxlint `1.83.0`、oxc crates `=0.150.0` 精确锁定。升级流程以 `AGENTS.md` 铁律 5 与 `.agents/skills/oxc-toolchain` 为准。
- **理由**：上游迭代快，诊断面漂移会破坏缓存、指纹与基线。
- **日期**：2026-10

## D10 · 规范分「目标态 / 现状」两栏

- **结论**：规则/边界文档中的未实现约束必须标注「目标态（Gx 未完成）」；现状以 `upgrade-plan.md` 与 `execution-todo.md` 为准。
- **理由**：避免 AI 把目标态当事实，导致评审口径再次漂移。
- **日期**：2026-10

## D11 · M4 引擎诊断不缓存（G1）

- **结论**：内容缓存只存 M1（oxlint）按文件诊断；引擎（含图规则）每轮按当前扫描文件集全量 pass，结果不落盘。缓存键 = 文件路径 + 内容哈希 + tsconfig + engine/config/plugin 指纹；空结果也缓存；条目写入 tmp + rename 原子发布。
- **理由**：图规则/跨文件结果依赖全局文件集，按单文件缓存无法保证冷热等价；引擎结果不缓存从根上消除陈旧环复用与引擎降级毒化。M5 跨文件增量（变更集/影响面/摘要缓存）另行设计。
- **来源**：`docs/changes/20261030-cache-correctness/`；`upgrade-plan.md` §7 G1；`execution-todo.md` W5。
- **日期**：2026-10-30

## D12 · 契约 v3：被抑制诊断保留在报告，summary/exit 以未抑制集合为准

- **结论**：行内抑制 `// lintsight-ignore-next-line <ruleId>: <reason>` 命中的诊断仍保留在 `report.diagnostics`，带 `suppression{kind,justification,directiveLine}`；`summary.error/warning/info`、exit code、`--fail-on` 一律只统计未抑制诊断，`summary.suppressed` 单独计数；SARIF 用 `results[].suppressions` 标记。
- **理由**：SARIF 规范要求被抑制结果仍在 `results[]`；平台审计需要 reason；删除会造成 JSON/SARIF 口径分裂。消费方必须以 summary 或 suppression 字段为准，不能只看 `diagnostics.length`。
- **来源**：`docs/changes/20261030-contract-v3/`；`upgrade-plan.md` §8 M4 契约 v3。
- **日期**：2026-10-30
