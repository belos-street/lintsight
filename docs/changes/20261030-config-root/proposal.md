# Proposal: G13 配置根与路径契约（--root）

> change-id：`20261030-config-root` · 日期：`2026-10-30` · 状态：代码验收完成；**scanner 对 `--root` 传参签字待补 → G13 保持 `[~]`**（与 G2/G6 同口径）

## 确认记录

- 2026-10-30：方案评审补强后，用户以消息全文 **「好的，按这个方案开始实现 G13、G14 和 G3」** 确认进入实现（无独立消息 ID，仓库内只能引用原话）；确认范围 = G13/G14/G3 三份 change 的三层文档全量方案。

## 评审整改（2026-10-30）

- **Medium 1（状态口径）**：G13 原标 `[x]` 与「scanner 传参签字可后补」不一致；按 G2/G6 同口径回退 `[~]`，代码验收完成、外部签字 pending，证据中显式写明。
- **Medium 2（覆盖不足/证据过度声明）**：新增 3 组 root 回归：root 相对 `ignore`、root 下 `.vue` 虚拟块回映射 + 行内抑制、root 外输入告警且保留绝对路径；证据不再声称「引擎 spawn 已断言」——引擎 bin 相对解析由 `engine-bridge.test.ts` 覆盖，pipeline 级 spawn 未单列。
- **Low 1（根外判定）**：`relOf` 从 `rel.startsWith('..')` 改为 `path.isAbsolute(rel) || rel.split('/')[0] === '..'`，避免文件名以 `..` 开头时误报 warning。
- **Low 2（缺值语义）**：`--root` 后接另一个选项（如 `--output`）时按「缺少取值」exit 2，而不是把 `--output` 当 root 值后报 `root path not found`；补 CLI 用例。

## 背景与问题

当前 pipeline 的全部路径都以 `cwd` 为基准：配置发现（`resolveConfigFile(cwd)`）、生成 oxlintrc、ignore 匹配、tsconfig 发现、Vue 虚拟化、`normalizeFilePath`、缓存目录、引擎 `--root` 与报告 `file` 字段。CLI 没有 `--root`，scanner 若不 chdir 就无法扫描外部项目：

- 外部目标不会被其自身的 `lintsight.config.json` 驱动；
- 诊断 `file` 落成 `C:/Users/...` 或 `/Users/...` 绝对路径，平台无法映射到仓库文件；
- 缓存写到当前 cwd 的 `.lintsight-cache`，污染调用方工程。

评审 H9 与本执行清单 G13 要求「外部目标用其自身配置且报告相对路径」。

## 目标与非目标

- 目标：
  - 新增 `--root <dir>`；未提供时根 = cwd（现有行为不变）。
  - 根优先级：显式 `--root` > 显式 `--config`（相对根解析） > cwd 默认配置。
  - config / ignore / tsconfig / Vue 虚拟化 / 诊断路径 / 缓存目录 / 引擎 `--root` / 报告路径全部 root 相对。
  - 外部绝对路径目标：以目标为 root 扫描，报告 `file` 不含 `C:/` / `/Users/` 绝对前缀。
  - 输入路径：相对路径按 root 解析；绝对路径原样接受。
- 非目标：
  - 不做多根 workspace / monorepo 多 project 聚合。
  - 不改 scanner 的任务/上传/并发语义（D4）。
  - 不把根外输入强行映射（根外文件仍按现有规则报告，必要时告警）。
  - 不引入环境变量隐式 root（避免不可见状态）。

## 方案选型

| 方案 | 做法 | 取舍 | 结论 |
| --- | --- | --- | --- |
| A. 继续要求 scanner chdir | 文档约定 cwd=项目根 | 不可控、易污染调用方缓存；评审 H9 明确否决 | 否决 |
| B. `--root` 显式根（推荐） | root 覆盖全部路径基准；`--config` 相对 root | 与 scanner 调用契约一致；默认行为不变 | **采纳** |
| C. 以 `--config` 所在目录当根 | root=dirname(config) | 配置放 `config/` 时根错误；语义隐式 | 否决 |

## 影响面清单

- 代码面：
  - `packages/lintsight-cli/src/cli.ts`（`--root` 解析）
  - `packages/lintsight-cli/src/pipeline.ts`（cwd → root 全量贯通）
  - `packages/lintsight-config-bridge/src/index.ts`（config 解析显式根）
  - 相关测试：`config-root.test.ts`、`ignore.test.ts`、CLI 集成
- 契约面：CLI 参数面、报告 `file` 路径口径、缓存目录位置；诊断 schema 不变
- 文档面：本 change、`execution-todo.md` G13、`upgrade-plan.md`（root/cwd 契约）
- 测试面：外部绝对路径、嵌套 config、显式 `--config`、ignore 回归
- Rust：无改动

## Breaking Changes

- `--root` 为新增 opt-in；不传时行为不变。
- 传 `--root` 后：配置/缓存/报告路径基准变为该根；缓存条目因路径基准变化会一次性 miss。
- 无规则文案/指纹/schema 变化。

## 验收标准

- 三组集成测试：
  1. 外部绝对路径项目（临时目录）`--root <dir>`：config 正确发现，报告 `file` 全部相对；
  2. 嵌套 config（`--config sub/lintsight.config.json`，相对 root）：生成配置正确；
  3. 显式 `--config` 覆盖 root 默认配置。
- oxlint 与引擎的二进制解析/spawn 均以 root 为基准（不会误用调用方二进制或误判 missing）。
- `--output` 按进程 cwd 落盘；报告内 `file` 仍 root 相对。
- `--root` 缺值/不存在/非目录均 exit 2；`ignore.test.ts`、Vue/`.lintsight-cache` 回归全绿。
- 报告 `file` 断言不含 `C:/`、`/Users/`、盘符绝对前缀。
- `bun run test` / `lint` / `format:check` 全绿；`corpus:check` 不改检测面，漂移只归因。
