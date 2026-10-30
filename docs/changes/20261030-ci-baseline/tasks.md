# Tasks: G3 CI 与基线

> change-id：`20261030-ci-baseline` · 按依赖排序；每项完成后勾选，最后走 `verification.md`。
> 实现前需用户确认本方案；未确认禁止改代码面。

- [~] **任务 1：static / test / rust 三个 job**（workflow 已落地；rust job 首轮 CI 失败已修复；尚未有成功运行链接）
  - 涉及文件：新增 `.github/workflows/ci.yml`
  - 内容：Bun 1.4.2 + Rust 1.97.1 固定版本与缓存；static（build:rules/lint/format/version:check）；test 矩阵（Linux+Windows，cargo build --release 后 `REQUIRE_ENGINE=1 bun run test`）；rust 矩阵（fmt/clippy/test）。
  - 验收点：首次 PR 运行通过；至少一次失败运行（红）链接；OS 矩阵齐全；workflow 中无 `stable`/`latest` 浮动版本。
  - 首轮运行失败与修复（2026-10-30）：
    - 现象：`rust (ubuntu-latest)` / `rust (windows-latest)` exit 1；
    - 根因 1：`cargo fmt --all` / `cargo clippy` 在仓库根执行，而 `Cargo.toml` 在 `crates/lintsight-engine/`——统一改 `--manifest-path crates/lintsight-engine/Cargo.toml`；
    - 根因 2：`clippy -D warnings` 存量 8 个 error（`never_loop` 1、`needless_return` 5、`manual_flatten` 1、`non_upper_case_globals` 1）——按建议修代码，不引入 allow；
    - 根因 3：rustfmt 存量 9 处 diff（arch/graph/main/pkgexports）——`cargo fmt` 应用格式化；
    - 附：`actions/checkout@v4` → `v5`（消除 Node.js 20 deprecation 注解）。
    - 本地等价验证：`cargo fmt --manifest-path ... -- --check`（exit 0）、`cargo clippy --manifest-path ... --all-targets -- -D warnings`（exit 0）、`cargo test --release --manifest-path ...`（52 passed）。
  - change-id 历史截止点（评审整改）：
    - 现象：真实 CI 范围 `origin/main...HEAD` exit 1，被 `4b73641`/`027fd8f` 等制度前提交拦红；
    - 修复：`--since <cutoff>` → `resolveRange()` 合成 `cutoff..head`；workflow env `SPEC_FIRST_CUTOFF=d98c457`；
    - 验证：raw exit 1 / `--since d98c457` exit 0；`scripts/check-change-id.test.ts` 6 pass（含非法范围 exit 2 的调用方分支）。

- [x] **任务 2：check-change-id range 模式**
  - 涉及文件：`scripts/check-change-id.ts`、`package.json`、`scripts/check-change-id.test.ts`
  - 内容：`--range <base..head>` 逐提交校验；与 staged 模式并存；merge/revert 豁免；CI 调用 `check:change-id:ci`。
  - 验收点：单测覆盖复杂提交缺 change-id、含 change-id、少量代码、merge；CI static 阶段实际执行。

- [~] **任务 3：heavy job + 基线重建**（corpus 基线已重建并通过；bench 基线因本机无 hyperfine 未重建）
  - 涉及文件：`.github/workflows/ci.yml`、`scripts/bench-baseline.json`、`corpus/baseline-v0.json`
  - 内容：schedule/workflow_dispatch 触发；bench 与 corpus 在 `lintsight-heavy` runner 运行；启动预检 Bun 1.4.2 / Rust 1.97.1 / `hyperfine --version` / `git` / 网络与 `bun run corpus:sync`；先逐条归因，再人工 `bench --save` / `corpus:check -- --save`。
  - 验收点：bench <10s；corpus 双报率 0、基线一致；归因表与 diff 评审记录；G1/G2/G6 的 corpus FAIL 消失；runner 预检失败时明确报错而非静默跳过。
  - corpus 归因与跨平台复现（评审整改）：
    - 归因表（相对 `52b03db` 基线，3453 → **3392**，-61）：
      | rule | delta | 归因 |
      | --- | --- | --- |
      | `lintsight/no-floating-promise` | -28（276→248） | `027fd8f` self-handled async 收紧 |
      | `lintsight/no-hardcoded-credentials` | -33（61→28） | `027fd8f` i18n 文案抑制 |
      | 其余规则 | 0 | 指纹逐条一致（overlap=3392/3392，newOnly=0） |
    - 原 3540 基线的 `no-hardcoded +115` 与 oldOnly=1502/newOnly=1589 为 Windows 平台产物，非提交漂移：`isTestFile` 未识别反斜杠绝对路径（148/156 新增命中在 test/fixture 目录）；`corpus:sync` 未锁 LF 导致 CRLF offset 漂移。
    - 修复：`isTestFile` → `split(/[/\\]/)` + `fixtures/options/tests/**` 用例；`corpus:sync` → LF 克隆 + `.git/lintsight-lf` 标记（非 LF 检出重建）。
    - 验证：`bun run corpus:check` pass（3392 / 双报率 0）；`bun run corpus:check -- --save` 重建基线（3392 fingerprints）。

- [~] **任务 4：branch protection 与证据**（外部设置，未配置；无 CI 运行链接）
  - 涉及文件：无代码（仓库设置）
  - 内容：required checks 配置（static/test/rust 矩阵）；禁止直推 main；记录截图或 `gh api` 输出。
  - 验收点：设置证据落盘；至少一次红 PR 被阻断的记录；无管理员权限时标外部例外，不伪造签字。

- [x] **任务 5：全量验证与文档同步**
  - 涉及文件：`docs/upgrade/v0.1/execution-todo.md`、`upgrade-plan.md`、本 change
  - 内容：本地跑 workflow 等价命令；更新 G3 证据与状态；同步 G1/G2/G6 的 corpus 例外状态说明；记录基线 commit/date。
  - 验收点：命令摘要齐全；基线可追溯；不宣称 G11 发布自动化完成。
