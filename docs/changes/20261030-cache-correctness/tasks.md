# Tasks: G1 缓存正确性（路径 / 空结果 / 图规则冷热等价）

> change-id：`20261030-cache-correctness` · 按依赖排序；每项完成后勾选，最后走 `verification.md`。
> 实现前需用户确认本方案；未确认禁止改代码面。

- [x] **任务 1：tsconfig 发现逻辑抽出（供缓存指纹复用）**
  - 涉及文件：`packages/lintsight-cli/src/engine-bridge.ts`
  - 内容：新增 `discoverTsconfigs(cwd, roots)`（沿用现有深度/上限/跳过目录边界）；`resolveTsPaths` 增加可选 `discovered` 参数并复用该列表，避免 cache 初始化与引擎别名解析两次全树 IO。
  - 验收点：`bun run build:rules && bun test packages/lintsight-cli/test/engine-bridge.test.ts` 全绿（既有 tsPaths 嵌套/跳过 `node_modules` 用例不变）；`resolveTsPaths` 行为不变。

- [x] **任务 2：缓存键 / 条目 v2 / 原子写 / 插件路径（cache.ts）**
  - 涉及文件：`packages/lintsight-cli/src/cache.ts`
  - 内容：
    - `createCacheKey(ctx, storeRel, contentHash)`：键加入 `entry@2` 盐、路径、tsconfig 指纹；
    - `initCache` 新增 `tsconfigFiles?: string[]`，其内容哈希并入 `configFp`；
    - 插件 `jsPlugins` 相对路径按 oxlintrc 所在目录解析；
    - 条目 v2（`{v:2, engine, diagnostics}`，仅 M1）、空数组可命中；
    - 写入改为 tmp + rename 原子发布，失败 fail-open。
  - 验收点（新增单测，`packages/lintsight-cli/test/cache.test.ts`）：
    - `引擎版本指纹变化：lintsightVersion / engine bin 内容 → 新键`
    - `插件产物内容变化击穿：jsPlugins 相对路径按配置目录解析`
    - `同 key 并发写入：条目始终完整可解析`
    - `tsconfig 内容变化 → config 指纹变化`
    - 命令：`bun run build:rules && bun test packages/lintsight-cli/test/cache.test.ts`

- [x] **任务 3：pipeline 接线（路径键 / 空结果 / M1 与引擎分离 / 引擎全量 pass）**
  - 涉及文件：`packages/lintsight-cli/src/pipeline.ts`
  - 内容：
    - cache 初始化前调用 `discoverTsconfigs` 并传入 `tsconfigFiles`；
    - 探测键使用 `storeRel` + 原始内容哈希；命中判定 `entry !== null`；
    - 缓存回写只写 M1 分组，`m1Groups.get(storeRel) ?? []`（干净文件写空数组）；
    - `runEngine` 移出 `misses` 条件，始终传全部单元的 `scanRel`；新增 `unitMap` 用于引擎诊断回映射；
    - `PipelineResult` 增加 `cache: { enabled, hits, misses }`（不进报告 JSON）。
  - 验收点（`packages/lintsight-cli/test/cache.test.ts`）：
    - `同内容不同路径：诊断归属各自文件，冷/热一致`
    - `干净文件空结果入缓存：二轮全 hit`
    - `文件删除后不命中旧条目：诊断不含已删文件`
    - `--no-cache 与 cache 冷/热诊断集合一致`
    - 回归：`bun test packages/lintsight-cli/test/closed-loop.test.ts packages/lintsight-cli/test/report-snapshot.test.ts packages/lintsight-cli/test/ignore.test.ts packages/lintsight-cli/test/fix.test.ts`

- [x] **任务 4：图规则 / tsconfig / 降级恢复矩阵（skipIf 无引擎）**
  - 涉及文件：`packages/lintsight-cli/test/cache.test.ts`
  - 内容：
    - `importCycles` 项目：成环（a↔b）=2、断环=0、加文件成三节点环=3；每态冷/热/`cache:false` 三者一致；
    - tsconfig `paths` 别名：无 tsconfig 时 0 环，加 tsconfig（不改源码）后热扫 2 环，与 `cache:false` 一致；
    - 引擎降级恢复：`OXLINT_ENGINE_BIN` 指向不存在路径 → `degraded=true`，恢复后热扫仍出引擎诊断（证明降级不毒化缓存）。
  - 验收点：
    - `图规则冷热等价：成环 / 断环 / 加文件（importCycles）`
    - `tsconfig 别名变化冷热等价：别名解析成环`
    - `引擎降级期间写 M1 缓存，恢复后引擎诊断仍出现`
    - 命令：`bun run build:rules && bun test packages/lintsight-cli/test/cache.test.ts`（有引擎产物时三组必须执行，不允许 skip 静默通过而无说明）

- [x] **任务 5：全量验证与证据/文档同步**
  - 涉及文件：`docs/upgrade/v0.1/execution-todo.md`、`.agents/memory/decisions.md`、本 change 目录
  - 内容：
    - 按 `verification.md` 实际执行并附摘要：
      - `bun run test`
      - `cargo test --release --manifest-path crates/lintsight-engine/Cargo.toml`
      - `bun run lint`
      - `bun run format:check`
      - `bun run corpus:check`
    - 冷/热报告 diff 证据：同一目标连续两轮扫描（第二轮命中缓存）输出 JSON，`diff` 为空；
    - `execution-todo.md` G1 行写证据（测试名 + 命令 + diff 结果），状态按完成情况更新；**不触碰 M4 Exit Gate 与 H4/双跑的 `[!]`**；
    - `.agents/memory/decisions.md` 追加 D11：M4 引擎诊断不缓存（引擎每轮全量 pass；缓存只存 M1 按文件诊断；M5 跨文件增量另行设计）；
    - `proposal.md` 状态改为「已实现」。
  - 验收点：上述命令输出摘要齐全；`git diff` 中 golden 无静默漂移；本 change 三层文档无占位符；`bun run check:change-id -- <commit-msg-file>` 通过（`change/20261030-cache-correctness`）。

- [x] **任务 6：评审整改（2026-10-30）**
  - 涉及文件：`packages/lintsight-cli/src/cache.ts`、`packages/lintsight-cli/test/cache.test.ts`、`packages/lintsight-cli/test/fix.test.ts`、本 change 三层文档、`docs/upgrade/v0.1/{upgrade-plan,execution-todo}.md`
  - 内容：
    - B1：G1 回退 `[~]`，写明 corpus 基线陈旧阻塞与收口条件（G3 重建或用户批准例外）；
    - B2：proposal 补确认记录（2026-10-30，用户确认范围）；
    - H1：plan/execution-todo 的 G1 口径改为「引擎结果不缓存 + 全量 pass 覆盖文件集/依赖闭包」；
    - H2：`REQUIRE_ENGINE=1` 前置门禁，无引擎产物时不得静默 skip；
    - Medium：design 修正并发写语义、补证据复现命令、补相对 jsPlugins 端到端用例、fix 测试补缓存 tmp 零残留断言；
    - Low：修正旧测试覆盖描述、补 `.oxlintrc.json` `extends` 风险、缓存键改 JSON 数组序列化。
  - 验收点：`REQUIRE_ENGINE=1 bun test packages/lintsight-cli/test/cache.test.ts` 全绿；`bun run test` / `lint` / `format:check` / `cargo test --release` 全绿；G1 状态为 `[~]` 且有阻塞说明。
