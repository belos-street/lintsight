# Proposal: G3 CI 与基线（分阶段）

> change-id：`20261030-ci-baseline` · 日期：`2026-10-30` · 状态：已实现（CI 代码与 corpus 基线；branch protection / heavy runner / bench 基线外部 pending）

## 确认记录

- 2026-10-30：方案评审补强后，用户以消息全文 **「好的，按这个方案开始实现 G13、G14 和 G3」** 确认进入实现（无独立消息 ID，仓库内只能引用原话）；确认范围 = G13/G14/G3 三份 change 的三层文档全量方案。

## 背景与问题

仓库当前没有任何 CI（无 `.github/`、无 `.gitlab-ci.yml`）；质量门禁只靠本地命令：

- `bun run test` 不含 Rust；`cargo test/clippy/fmt` 无流水线；
- `check:change-id` 只读 **staged diff**，CI/PR 场景不可用；
- bench 基线停在 `5136929`、corpus 基线停在 `52b03db`，均已因后续规则提交而陈旧；
- 无 branch protection；评审 G3 与本执行清单要求「流水线红即阻断合并；基线按版本可追溯」。

## 目标与非目标

- 目标（三阶段）：
  1. **最小 CI**：`cargo build --release` → `REQUIRE_ENGINE=1 bun run test` + `lint` + `format:check` + `version:check` + `check:change-id`；
  2. **Rust 门禁**：`cargo test --release` + `clippy -D warnings` + `cargo fmt --check`；
  3. **重型门禁**：bench + corpus（专用 runner / 定时或手动）。
  - OS 矩阵至少 Linux + Windows；macOS 可选。
  - branch protection 将上述 required checks 设为合并阻断（仓库设置，外部配置，记录证据）。
  - 重建 bench/corpus 基线：先逐条归因，再 `--save`；基线随版本可追溯。
- 非目标：
  - 不做发布/签名/SBOM/多平台产物（G11，M6）。
  - 不做平台侧任务调度/扫描机（D4）。
  - 不在 CI 中自动 `bench --save` / `corpus:check -- --save`（基线只能人工评审后重建）。
  - 不引入第三方 SaaS 扫描或远端缓存。

## 方案选型

| 议题 | 方案 | 取舍 | 结论 |
| --- | --- | --- | --- |
| 工作流载体 | GitHub Actions vs GitLab CI | 仓库托管在 GitHub；先用 Actions | **GitHub Actions** |
| 任务拆分 | 单 job vs static/test/rust/heavy 多 job | 单 job 反馈慢、OS 矩阵难展开 | **多 job + needs** |
| 重型门禁 runner | GitHub-hosted vs 专用 runner | corpus 克隆 6 个仓库、bench 需 hyperfine；用专用 label 避免占公共额度 | **专用 runner（`lintsight-heavy`）**，无 runner 时手动触发 |
| check-change-id | 仅本地 hook vs CI range 模式 | 只有 hook 时 PR 可绕过；需要 CI 校验每个 commit | **给脚本加 `--range` 模式** |
| 基线重建 | CI 自动 save vs 人工评审后 save | 自动 save 会把误报固化 | **人工归因后显式 save** |

## 影响面清单

- 代码面 / CI：
  - 新增 `.github/workflows/ci.yml`（static / test matrix / rust matrix / heavy）
  - `scripts/check-change-id.ts`（新增 `--range <base..head>` 模式）
  - `package.json`（`check:change-id:ci` / `version:check` 等 script）
- 基线：
  - `scripts/bench-baseline.json`（重建）
  - `corpus/baseline-v0.json`（逐条归因后重建）
- 文档面：本 change、`execution-todo.md` G3/G1/G2/G6 状态联动、`upgrade-plan.md` CI 验收
- 测试面：本地跑 workflow 等价命令；`actionlint`（可选）；range 模式单测
- Rust：无代码改动（只在 CI 跑 fmt/clippy/test）

## Breaking Changes

- PR 合并将受 required checks 阻断（仓库设置生效后）。
- 基线文件更新会改变 `bench` / `corpus:check` 的对比锚点；必须逐条归因并在评审中列出。
- `check:change-id --range` 为新增模式，默认 staged 模式不变。
- 无规则文案/指纹/schema 变化。

## 验收标准

- `.github/workflows/ci.yml` 在 PR 上运行；Linux + Windows 矩阵通过。
- 至少一次成功运行与一次失败（红）运行链接；branch protection 配置证据（required checks 列表/截图/API 输出）。
- `check:change-id --range` 在 PR 范围能拦截缺少 change-id 的复杂提交；单测覆盖。
- bench 基线重建后 `bun run bench` 通过 <10s 与回退门禁；corpus 基线逐条归因后 `bun run corpus:check` 通过（双报率 0）。
- G1/G2/G6 的 corpus FAIL 随基线重建消失；其 scanner 签字仍独立 pending。
