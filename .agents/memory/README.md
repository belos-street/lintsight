# 项目记忆：边界与二次封装约定

本目录保存跨会话需要长期保持的项目级约定。改代码、评估需求、写文档前先读这里。

## 核心边界

- **lintsight 是纯 JS/TS 静态分析引擎**，不是平台、不是 CI 工具、不是报告服务。
- 引擎只承诺三件事：
  1. **输入**：扫描根、包含/排除路径、规则启停、并发上限、可选变更文件集；
  2. **输出**：诊断 JSON / SARIF、指纹、证据链（pathEvents）、退出码（0/1/2）；目标态含 confidence/cweTags（G2 未完成）；
  3. **形态**：可被外部进程调用的单文件二进制（多平台）与稳定版本标识。
- **scanner CLI 负责**：多语言引擎编排、平台配置解析、Task 生命周期、报告/缺陷上传、基线/抑制同步、AI 研判调度、CI/CD 集成、扫描机调度。
- 平台侧功能（任务、报告、看板、策略中心、通知、账号权限）一律在 scanner 或平台二次封装；**禁止把平台职责塞进引擎**，否则破坏单一职责、可替换性与 fail-open 边界。

## 需求归属判定

| 需求形态 | 归属 |
| --- | --- |
| 新检测能力、规则、解析/数据流/框架语义、诊断格式 | 引擎（本仓） |
| 任务、上传、存储、展示、鉴权、通知、CI/CD、基线/抑制 | scanner / 平台 |
| 变更集计算（git diff） | scanner；引擎只消费文件列表 |
| 并发/内存/性能参数 | 引擎消费 scanner 传入的上限 |
| 规则 ID 与平台规则目录映射 | 平台侧维护；引擎保证 ruleId 稳定 |

## 相关文档

- 升级计划：[docs/upgrade/v0.1/upgrade-plan.md](../../docs/upgrade/v0.1/upgrade-plan.md)
- 执行清单：[docs/upgrade/v0.1/execution-todo.md](../../docs/upgrade/v0.1/execution-todo.md)
- 工作约定：[AGENTS.md](../../AGENTS.md)
- AI 规则：[.agents/rules](../rules)
- AI 工作流：[.agents/workflows](../workflows)
- 决策记录：[decisions.md](decisions.md)
- 规则开发：[.agents/skills/rule-authoring](../skills/rule-authoring)
