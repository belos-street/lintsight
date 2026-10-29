# AGENTS.md · lintsight

> 面向 AI 编码代理与本仓贡献者的工作约定。改代码前先读本文件；详细设计见「文档索引」。

## 项目一句话

**lintsight**：面向企业级大规模 JS/TS 代码库的静态分析引擎（SAST），M1 = oxlint 基座 + Bun 封装（自有规则走 oxlint JS Plugins），M2 = Rust 深度分析引擎（sidecar 双引擎，taint/DFG/调用图）。

**边界（详见 [.agents/memory/README.md](.agents/memory/README.md)）**：本仓只做 JS/TS 引擎。任务、报告/缺陷上传、基线/抑制、AI 研判、CI/CD、策略中心等平台能力由 `scanner` CLI 或平台二次封装，禁止塞进引擎。

## 铁律（违反即停）

1. **M1 不自建 Node 内核**——解析/调度/并行/规则宿主全部复用 oxlint，封装层只做编排与桥接。
2. **规则代码禁止直接依赖具体 parser 的 AST 类型**——JS 轨道走 ESLint 兼容 API 面（oxlint JS Plugins），Rust 轨道走引擎 IR API 面。这是解析器可替换的唯一保障。
3. **type-aware 规则不自实现**——`program` 级需求一律映射 oxlint `--type-aware`（tsgolint）规则集（M2 生效）。
4. **运行时绑死 Bun**（DR-7）——全仓使用 Bun API（`Bun.file`/`Bun.Glob`/`bun test`），禁止引入 Node.js 运行时依赖；`node:` 模块仅用 Bun 兼容子集。
5. **oxlint 版本精确锁定**（当前 `1.83.0`，无脱字符）——升级必须走 `.agents/skills/oxc-toolchain` 的 version-policy 门禁 + 重跑竖切测试套件。
6. **Rule ID 命名空间**——自有规则物理 id 一律 `lintsight/<rule-name>`，category 走 meta 不进 id。
7. **指纹口径**（M1-DR2）——`sha256(ruleId + file + span + message 文本)`；规则 `messages` 文案变更视同 breaking，走显式评审。

## 工程结构

```
lintsight/
├─ packages/                      # Bun workspaces（Bun 按 member 依赖把 @lintsight/* 链接在各包 node_modules 下）
│  ├─ lintsight-cli/              # @lintsight/cli：CLI 参数面 + pipeline 编排 + oxlint spawn 桥接
│  │  └─ test/                    #   闭环测试 / RuleTester / exit 2 契约 / golden 报告
│  ├─ lintsight-config-bridge/    # @lintsight/config-bridge：lintsight.config.json(JSONC) → .oxlintrc + 内置映射清单
│  ├─ lintsight-diagnostic/       # @lintsight/diagnostic：统一诊断模型 / 归一化 / 指纹 / 规则注册表
│  ├─ lintsight-formatter/        # @lintsight/formatter：json / text 报告器
│  ├─ lintsight-rule-sdk/         # @lintsight/rule-sdk：defineRule / definePlugin 契约校验 + RuleTester
│  ├─ lintsight-shared/           # @lintsight/shared：logger
│  ├─ lintsight-vue-processor/    # @lintsight/vue-processor：SFC 虚拟块 + 位置回映射
│  └─ rules-core/                 # @lintsight/rules-core：自有规则源码（每规则一文件，纯 JS）
├─ plugins/
│  └─ lintsight-rules/            # 规则集构建产物（bun build 聚合，自包含单文件，提交 git）——oxlint 嵌入式 runtime 不支持相对 import，禁止手改此文件
├─ fixtures/                      # 规则用例契约（断言依赖行/列布局——禁止格式化此目录；首行 // @ts-nocheck 是 IDE 对故意坏代码的静音标记，勿删）
├─ lintsight.config.json          # 引擎自身 dogfood 配置（config-bridge 消费）
├─ docs/
│  ├─ requirements/               # 需求与总体技术设计（v0.x 版本化）
│  ├─ design/                     # 里程碑设计文档（design-m1-v0.1.md）
│  ├─ spikes/                     # spike/竖切验证报告（可验证证据）
│  ├─ changes/                    # 当次变更三层文档（spec-first；proposal/design/tasks）
│  ├─ templates/change/           # 变更文档模板
│  └─ upgrade/v0.1/               # 升级计划 + 执行清单 + 独立评审快照
├─ corpus/                        # 回归语料库（M0 交付物，暂未建）
├─ .githooks/                     # commit-msg spec-first 校验（可选启用 core.hooksPath）
└─ .agents/
   ├─ rules/                      # 规则（spec-first / workflow / verification / memory 常驻；project / commit 按需）
   ├─ workflows/                  # 工作流（feature / rule-change / bug-fix / hotfix / refactor）
   ├─ skills/                     # 工程技能（oxc-toolchain / rule-authoring / belos-street / sast-review）
   └─ memory/                     # 引擎边界 README + decisions.md 决策记录
```

## 常用命令

```bash
bun install                 # 安装（bun.lock 提交，禁 npm/pnpm/yarn）
bun run test                # 全部测试（先自动构建规则集产物；⚠️ 用 bun run test 而非裸 bun test——后者会扫到 corpus/ 里第三方库的测试）
bun run cli -- <paths>      # 扫描（exit: 0 无 error / 1 有 error / 2 运行错误）
bun run lint                # dev-lint（按目录收窄到 packages+plugins，勿全仓扫——fixtures 是故意的坏代码）
bun run lint:fix
bun run format              # oxfmt（fixtures 已排除）
bun run build:rules         # 规则源（packages/rules-core）聚合为自包含产物（bun run test 已自动执行）
bun run build:binary        # 先 cargo build --release 引擎 + bun build --compile 单文件（产物 59MB，dist/ 已 gitignore）
bun run bench               # hyperfine 万行基准（--no-cache 冷扫；<10s 硬门禁 + 回退 >15% 拦截）
bun run corpus:sync         # 语料库同步（zod/dayjs/express/juice-shop/nodegoat/ghost 锁定 tag 浅克隆到 corpus/repos/）
bun run corpus:check        # 语料库基线：全量扫描 + 双报率 0 断言 + 指纹级基线 diff（-- --save 重建基线）
```

环境变量：`OXLINT_BIN` 显式指定 oxlint 可执行文件；`OXLINT_ENGINE_BIN` 显式指定深度引擎二进制（平台 worker / CI 镜像场景）。

## AI 协作工作流（承接需求时先读）

> 入口只做导航；规则在 `.agents/rules/`，步骤在 `.agents/workflows/`，决策在 `.agents/memory/decisions.md`。

### 意图路由

| 请求类型 | 工作流 | 关键闸门 |
| --- | --- | --- |
| 新功能 / 新引擎能力 / 新框架 profile / 新 formatter | [feature-development](.agents/workflows/feature-development.md) | 复杂需求先出三层文档并等确认 |
| 新增 / 修改 / 删除规则 | [rule-change](.agents/workflows/rule-change.md) | 用例先行 + meta 完备 + 语料门禁 + 注册表 |
| 误报 / 漏报 / 缺陷 | [bug-fix](.agents/workflows/bug-fix.md) | 先复现再修复；最小改动 |
| 线上 / 阻断性故障 | [hotfix](.agents/workflows/hotfix.md) | 最小止血；24h 内补记录 |
| 重构 / 架构调整 / 技术债 | [refactor](.agents/workflows/refactor.md) | 必走三层文档；行为不变 |
| 评审引擎 / SAST 尽调 | [sast-review](.agents/skills/sast-review/SKILL.md) | 独立评分 + 证据口径 |

### 规则与记忆

| 文件 | 作用 |
| --- | --- |
| [spec-first.md](.agents/rules/spec-first.md) | 复杂需求先出 `docs/changes/<change-id>/` 三层文档，未确认禁止改代码 |
| [workflow-guide.md](.agents/rules/workflow-guide.md) | 意图路由与公共红线 |
| [verification.md](.agents/rules/verification.md) | 完工前必须实际跑测试/lint/format 并附证据 |
| [memory.md](.agents/rules/memory.md) | 决策追加到 `.agents/memory/decisions.md`；复盘三问 |
| [project_rules.md](.agents/rules/project_rules.md) | 代码规范来源：belos-street / rust-best-practices / rule-authoring / oxc-toolchain |
| [git-commit-message.md](.agents/rules/git-commit-message.md) | Conventional Commits + 中文 + change-id |

### 开工前 / 完工前

- **开工前**：读 `.agents/memory/decisions.md` + 相关升级计划/设计/spike；复杂需求先走 spec-first；规则改动先读 `rule-authoring`。
- **完工前**：按 `verification.md` 跑 `bun run test`、`cargo test --release`、`bun run lint`、`bun run format:check`；规则/引擎行为变化再跑 `corpus:check`；交付说明附输出摘要。
- **收尾**：更新 `docs/upgrade/v0.1/execution-todo.md` 状态；重要决策追加 `decisions.md`；按 `git-commit-message.md` 原子提交，推 dev 分支，不直接推 `main`。
- **机器门禁**：`git config core.hooksPath .githooks` 后 `commit-msg` 校验生效（首次提交用 `git add --chmod=+x .githooks/commit-msg`）；未启用时仍按 `spec-first` 约定执行。

### 单一事实来源

| 主题 | 唯一权威处 |
| --- | --- |
| 范围 / 决策 / 验收 | `docs/upgrade/v0.1/upgrade-plan.md` |
| 执行状态 / 证据 | `docs/upgrade/v0.1/execution-todo.md` |
| 评审快照 | `docs/upgrade/v0.1/review-report-v0.1.md`（只读，计划已修正其口径） |
| 本次变更 | `docs/changes/<change-id>/` |
| 长期决策 | `.agents/memory/decisions.md` |

## 代码风格

- oxfmt：单引号 / 无分号 / 无尾逗号 / 2 空格 / 80 列 / LF（`.oxfmtrc.jsonc`）。
- oxlint dev-lint：correctness=error、suspicious=warn、perf=warn（`.oxlintrc.json`）；0 警告基线，新警告必须修复或显式豁免。
- ⚠️ **oxlint `ignorePatterns` 严格相对「配置文件所在目录」解析**（实测报错原文：`patterns are resolved within the config file's directory`，且 `..` 形态会被直接拒绝）——lintsight 生成的 oxlintrc 位于 `.lintsight-cache/`（比项目根深一层），故**任何项目根相对的用户 ignore 模式在 oxlint 侧都不可达**。`lintsight.config.json` 的 `ignore` / 内置默认忽略 / 打包产物启发式一律由 pipeline 侧过滤执行（`packages/lintsight-cli/src/pipeline.ts`）；不要往生成配置里写 ignorePatterns。

## 开发纪律

- **承接需求先按 AI 协作工作流路由**（见上节）；复杂需求先出 `docs/changes/<change-id>/` 三层文档并等确认，未确认禁止改代码。
- **重要决策追加** `.agents/memory/decisions.md`；承接任务前先读，避免重复讨论或推翻既有结论。
- **写规则前必读** `.agents/skills/rule-authoring`（用例先行 → meta 完备 → 语料库门禁 → 注册表登记）。
- **动 oxlint 配置 / spike / 升级前必读** `.agents/skills/oxc-toolchain`。
- **写码 / review / 写文档前**参考 `.agents/skills/belos-street`。
- **评审引擎 / 做 SAST 项目尽调前**读 `.agents/skills/sast-review`（独立评分、证据口径与框架扩展性检查）。
- **需求归属先读** `.agents/memory/README.md`：只做 JS/TS 引擎；平台/任务/上传/CI 等由 `scanner` 二次封装，不得进本仓。
- spike 任务必须产出可验证证据（`docs/spikes/` 报告）才算完成。
- 文档版本化：requirements-v0.x.md / design-*-v0.x.md 带修订记录；决策记录（DR）必须含备选与否决理由。
- fixtures 是规则的用例契约：改实现不改用例 = 没改对；放宽断言必须在 PR 说明。
- 报告 golden file：`packages/lintsight-cli/test/__golden__/`——报告 schema 或规则面变化的 diff 即评审信号；重新生成：删除该文件重跑 `bun run test`。
- ⚠️ **Bun workspaces 链接坑**：member 的 package.json 依赖变更后 `bun install` 可能不重建链接（报 no changes 但模块找不到）——删除该 member 的 `node_modules/` 再 `bun install`。
- 提交前：`bun run format && bun run lint && bun run test` 全绿。

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [docs/requirements/requirements-v0.2.md](docs/requirements/requirements-v0.2.md) | 总体技术设计（选型/架构/里程碑/风险） |
| [docs/design/design-m1-v0.1.md](docs/design/design-m1-v0.1.md) | M1 实现设计（M1-DR1~7 决策、S1~S7 切片） |
| [docs/design/p0-rules-proposal-v0.1.md](docs/design/p0-rules-proposal-v0.1.md) | P0 规则清单提案（差异化 24+1 条，CWE/OWASP 映射，待评审） |
| [docs/design/design-m2-v0.1.md](docs/design/design-m2-v0.1.md) | M2 实现设计（sidecar 协议/taint 模型/M2-DR1~5，待评审） |
| [docs/design/rule-sdk-rfc-v0.1.md](docs/design/rule-sdk-rfc-v0.1.md) | rule-sdk 接口 RFC（T1.0a，待评审） |
| [docs/spikes/vertical-slice-m1.md](docs/spikes/vertical-slice-m1.md) | 竖切验证报告（技术可行性实证 + oxlint 行为实测） |
| [docs/spikes/oxc-crate-poc.md](docs/spikes/oxc-crate-poc.md) | spike ①：oxc crate 直连 PoC（M2 路线验证，性能/内存/CFG 实测） |
| [docs/spikes/tsgolint-spike3.md](docs/spikes/tsgolint-spike3.md) | spike ③：tsgolint 类型感知实测（跑通性/兼容坑/no-misused-promises/sourceCode 能力） |
| [docs/spikes/taint-poc-spike5.md](docs/spikes/taint-poc-spike5.md) | spike ⑤：taint 竖切预演（CFG worklist 传播模型/sanitizer/不动点） |
| [docs/upgrade/v0.1/upgrade-plan.md](docs/upgrade/v0.1/upgrade-plan.md) | JS/TS 引擎升级评估与计划（范围/决策/验收） |
| [docs/upgrade/v0.1/execution-todo.md](docs/upgrade/v0.1/execution-todo.md) | M4/M5/M6 执行清单（G-ID、owner、证据、状态） |
| [docs/upgrade/v0.1/review-report-v0.1.md](docs/upgrade/v0.1/review-report-v0.1.md) | 独立评审快照（只读；口径修正见 upgrade-plan） |
| [docs/changes/README.md](docs/changes/README.md) | 变更记录约定（spec-first 三层文档、change-id） |
| [docs/templates/change/](docs/templates/change/) | proposal / design / tasks 模板 |
