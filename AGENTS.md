# AGENTS.md · lintsight

> 面向 AI 编码代理与本仓贡献者的工作约定。改代码前先读本文件；详细设计见「文档索引」。

## 项目一句话

**lintsight**：面向企业级大规模 JS/TS 代码库的静态分析引擎（SAST），M1 = oxlint 基座 + Bun 封装（自有规则走 oxlint JS Plugins），M2 = Rust 深度分析引擎（sidecar 双引擎，taint/DFG/调用图）。

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
│  ├─ lintsight-shared/           # @lintsight/shared：logger
│  └─ lintsight-vue-processor/    # @lintsight/vue-processor：SFC 虚拟块 + 位置回映射
├─ plugins/
│  └─ lintsight-rules/            # 自有规则集（JS Plugin，跑在 oxlint 嵌入式 runtime，禁 Node/Bun API）
├─ fixtures/                      # 规则用例契约（断言依赖行/列布局——禁止格式化此目录）
├─ lintsight.config.json          # 引擎自身 dogfood 配置（config-bridge 消费）
├─ docs/
│  ├─ requirements/               # 需求与总体技术设计（v0.x 版本化）
│  ├─ design/                     # 里程碑设计文档（design-m1-v0.1.md）
│  ├─ spikes/                     # spike/竖切验证报告（可验证证据）
│  └─ todo.md                     # 当前执行 Todo（滚动更新）
├─ corpus/                        # 回归语料库（M0 交付物，暂未建）
└─ .agents/skills/                # 工程技能（oxc-toolchain / rule-authoring / belos-street）
```

## 常用命令

```bash
bun install                 # 安装（bun.lock 提交，禁 npm/pnpm/yarn）
bun test                    # 全部测试（13 例竖切套件 + RuleTester）
bun run cli -- <paths>      # 扫描（exit: 0 无 error / 1 有 error / 2 运行错误）
bun run lint                # dev-lint（按目录收窄到 packages+plugins，勿全仓扫——fixtures 是故意的坏代码）
bun run lint:fix
bun run format              # oxfmt（fixtures 已排除）
bun run build:binary        # bun build --compile 单文件（产物 59MB，dist/ 已 gitignore）
```

环境变量：`OXLINT_BIN` 显式指定 oxlint 可执行文件（平台 worker / CI 镜像场景）。

## 代码风格

- oxfmt：单引号 / 无分号 / 无尾逗号 / 2 空格 / 80 列 / LF（`.oxfmtrc.jsonc`）。
- oxlint dev-lint：correctness=error、suspicious=warn、perf=warn（`.oxlintrc.json`）；0 警告基线，新警告必须修复或显式豁免。
- ⚠️ **oxlint `ignorePatterns` 对显式传入的路径同样生效**（实测）——不要用它排除 `.lintsight-cache` 等运行时产物目录。

## 开发纪律

- **写规则前必读** `.agents/skills/rule-authoring`（用例先行 → meta 完备 → 语料库门禁 → 注册表登记）。
- **动 oxlint 配置 / spike / 升级前必读** `.agents/skills/oxc-toolchain`。
- **写码 / review / 写文档前**参考 `.agents/skills/belos-street`。
- spike 任务必须产出可验证证据（`docs/spikes/` 报告）才算完成。
- 文档版本化：requirements-v0.x.md / design-*-v0.x.md 带修订记录；决策记录（DR）必须含备选与否决理由。
- fixtures 是规则的用例契约：改实现不改用例 = 没改对；放宽断言必须在 PR 说明。
- 报告 golden file：`packages/lintsight-cli/test/__golden__/`——报告 schema 或规则面变化的 diff 即评审信号；重新生成：删除该文件重跑 `bun test`。
- 提交前：`bun run format && bun run lint && bun test` 全绿。

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [docs/requirements/requirements-v0.2.md](docs/requirements/requirements-v0.2.md) | 总体技术设计（选型/架构/里程碑/风险） |
| [docs/design/design-m1-v0.1.md](docs/design/design-m1-v0.1.md) | M1 实现设计（M1-DR1~7 决策、S1~S7 切片） |
| [docs/spikes/vertical-slice-m1.md](docs/spikes/vertical-slice-m1.md) | 竖切验证报告（技术可行性实证 + oxlint 行为实测） |
| [docs/todo.md](docs/todo.md) | 当前执行 Todo |
