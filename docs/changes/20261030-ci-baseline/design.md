# Design: G3 CI 与基线

> change-id：`20261030-ci-baseline` · 日期：`2026-10-30`

## 技术设计

### 1. 工作流结构（GitHub Actions）

`.github/workflows/ci.yml`：

```yaml
name: ci
on:
  push:
    branches: [main, dev/**]
  pull_request:
  schedule: [{ cron: '0 2 * * 1' }]   # 每周一 heavy
  workflow_dispatch:

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  static:
    runs-on: ubuntu-latest
    steps:
      - checkout (fetch-depth: 0)
      - setup-bun (bun-version: 1.4.2)
      - bun install --frozen-lockfile
      - bun run build:rules
      - bun run lint
      - bun run format:check
      - bun run version:check
      - bun run check:change-id:ci   # PR/push 范围模式

  test:
    needs: static
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - checkout
      - setup-bun (bun-version: 1.4.2)
      - rust-toolchain (toolchain: 1.97.1 + cache)
      - cargo build --release --manifest-path crates/lintsight-engine/Cargo.toml
      - bun install --frozen-lockfile
      - env: REQUIRE_ENGINE=1
        run: bun run test

  rust:
    needs: static
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - checkout
      - rust-toolchain (toolchain: 1.97.1 + rustfmt + clippy + cache)
      - cargo fmt --manifest-path crates/lintsight-engine/Cargo.toml -- --check
      - cargo clippy --manifest-path crates/lintsight-engine/Cargo.toml --all-targets -- -D warnings
      - cargo test --release --manifest-path crates/lintsight-engine/Cargo.toml

  heavy:
    if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'
    runs-on: [self-hosted, lintsight-heavy]
    steps:
      - checkout (fetch-depth: 0)
      - setup-bun
      - cargo build --release --manifest-path crates/lintsight-engine/Cargo.toml
      - bun install --frozen-lockfile
      - bun run bench
      - bun run corpus:check
```

- `static` 是最快反馈层；`test`/`rust` 依赖它，避免明显失败时浪费矩阵。
- `test` 先 `cargo build --release`，再以 `REQUIRE_ENGINE=1` 跑全量测试，保证图规则矩阵不静默 skip。
- `rust` 独立跑 fmt/clippy/test，避免与 JS 测试互相掩盖。
- `heavy` 只在定时/手动触发；不自动 `--save`。
- 无 self-hosted `lintsight-heavy` runner 时，heavy job 保持 pending/跳过，不阻塞普通 PR。

### 2. `check-change-id` CI 模式

当前脚本只读 staged diff（本地 hook 用）。G3 增加：

```text
bun run check:change-id:ci -- <base-ref>
```

行为：

1. `git log --format=%H <base>..HEAD` 逐提交；
2. 对每个提交 `git show --name-only --format=` 统计有效代码文件（沿用现有 EXCLUDE 规则）；
3. 提交信息已含 `change/<YYYYMMDD-主题>` → 放行；
4. 有效代码文件 ≥3 且无 change-id → 失败并列出 commit + 文件数；
5. merge/revert 跳过（与现有逻辑一致）。

CI 中 `base` = `origin/${{ github.base_ref || 'main' }}`；`fetch-depth: 0` 保证可解析。
默认不带参数的 staged 模式保持不变。

> `check-change-id:ci` 是 G3 的实现任务（任务 2）；在工作流合入前，CI 的 change-id 门禁仅存在于文档，static job 需等任务 2 完成后再启用该步骤，避免假绿。

### 3. branch protection（外部配置）

工作流本身不能开启分支保护；需要在仓库设置（或 `gh api` 管理员 token）配置：

- required status checks：`static`、`test (ubuntu-latest)`、`test (windows-latest)`、`rust (ubuntu-latest)`、`rust (windows-latest)`。
- 禁止直推 `main`；PR 必须通过 required checks。
- 记录：设置页截图或 `gh api repos/<owner>/<repo>/branches/main/protection` 输出。

G3 的代码验收不依赖该外部配置；**状态收口要求该证据**，未配置前 G3 保持 `[~]`。

### 4. 基线重建

bench：

- 现状：`scripts/bench-baseline.json` 停在 `5136929`。
- 步骤：heavy runner 跑 `bun run bench` 确认 <10s 与 <15% 回退；再 `bun run bench --save`。
- 记录 commit/date/lines/files；diff 评审.

corpus：

- 现状：`corpus/baseline-v0.json` 停在 `52b03db`；当前 drift `no-floating-promise -28` / `no-hardcoded-credentials +115`。
- 归因：逐条对应基线后的规则提交（`027fd8f` 误报治理、`abe8326` serve-index 源头、`b8928dc` 前缀逃逸等）；输出归因表。
- 步骤：`bun run corpus:check -- --save`（人工评审后）。
- 效果：G1/G2/G6 的 corpus FAIL 消失；scanner 签字仍独立 pending。
- 禁止在普通 PR/CI 中自动 `--save`。

### 5. OS 矩阵与 runner 约束

- 必测：`ubuntu-latest`、`windows-latest`（缓存 rename、路径分隔符、可执行探测差异）。
- macOS 可选（后补 job，不阻塞 G3）。
- **版本固定**：Bun `1.4.2`（`setup-bun` 的 `bun-version`）；Rust `1.97.1`（`dtolnay/rust-toolchain` 的 `toolchain`，或新增 `rust-toolchain.toml` 锁定同一版本）。禁止 `stable`/`latest` 让 runner 漂移。
- heavy runner 需预装并校验：Bun `1.4.2`、Rust `1.97.1`、`hyperfine`（`hyperfine --version`）、`git`、网络（corpus clone 6 个公开仓库）；job 启动时先跑 `bun run corpus:sync` 与工具版本断言，再 `bench` / `corpus:check`。

### 6. 与既有门禁的关系

- `.githooks/commit-msg` 保留本地即时拦截；CI range 模式补 PR 面。
- `REQUIRE_ENGINE=1`（G1/G6）在 `test` job 生效。
- `version:check`（G14）在 `static` 生效。
- 不改变测试内容/阈值；只改执行环境与阻断方式。

## 涉及文件清单

- 新增：`.github/workflows/ci.yml`
- 改动：`scripts/check-change-id.ts`（range 模式）
- 改动：`package.json`（`check:change-id:ci` 等 script）
- 改动（测试）：`scripts/check-change-id.test.ts`（range 模式单测）
- 改动（基线）：`scripts/bench-baseline.json`、`corpus/baseline-v0.json`
- 文档：`docs/upgrade/v0.1/execution-todo.md`、`upgrade-plan.md`、本 change
- Rust：无代码改动

## 测试计划

| 用例 | 断言 |
| --- | --- |
| range 模式：复杂提交缺 change-id | exit 1，列出 commit |
| range 模式：含 change-id / merge/revert / 少量代码 | exit 0 |
| 本地 workflow 等价命令 | `bun run test`、`lint`、`format:check`、`version:check` 全绿 |
| Windows/Linux 矩阵 | 首次 PR 运行通过 |
| heavy | bench <10s；corpus 双报率 0、基线一致 |
| 基线重建 | diff 有归因表；`--save` 仅人工触发 |

## 风险与已知坑

1. **branch protection 是外部设置**：无管理员权限时 G3 无法收口；只能出「未闭合」例外报告（与 H4 同纪律）。
2. **heavy runner 不存在**：job 会排队/pending；先保证 static/test/rust 三 job 可用，heavy 以手动触发记录为证据。
3. **corpus 网络与时长**：6 个仓库浅克隆；失败时区分网络失败与诊断漂移，不用 `--save` 掩盖。
4. **Windows 矩阵差异**：缓存 rename EPERM、路径分隔符、可执行探测；测试已按条件降级，但 CI 需实跑确认。
5. **range 模式复杂提交**：按提交粒度统计文件数，避免把多个小提交错误合并判定；脚本需单测。
6. **基线更新是评审信号**：必须附归因表与 diff，不能静默提交基线漂移。
7. **CI 缓存**：Bun/cargo 缓存命中失败不应改变测试语义；缓存 key 按 lockfile/Cargo.lock。
