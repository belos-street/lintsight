# Proposal: G1 缓存正确性（路径 / 空结果 / 图规则冷热等价）

> change-id：`20261030-cache-correctness` · 日期：`2026-10-30` · 状态：已实现

## 确认记录

- 2026-10-30：三层文档产出后，用户以消息全文 **「好的，按这个方案开始执行 G1」** 确认进入实现（会话未提供精确时刻，故只记日期）。
- 确认范围 = 本目录 `proposal.md` / `design.md` / `tasks.md` 全量方案（含「引擎诊断不缓存、每轮全量 pass」与 8 组矩阵验收口径）；确认后才开始改代码面。

## 背景与问题

独立评审（MVP **6.0** / 企业级替代 **3.3**，±0.5）把「增量缓存与契约不可信」列为企业替代视角的主要失分项；升级计划 §7 G1 与执行清单 W5 要求「先修正确性再谈性能」，并给出 8 组验收矩阵。现状实现存在六个具体缺陷：

1. **同内容不同路径错配**：`createCacheKey` 只含引擎/配置/插件/文件内容，不含路径（[cache.ts](../../../packages/lintsight-cli/src/cache.ts) `createCacheKey`）。两个内容相同的文件共享 key，缓存条目里的 `file` 字段属于先写入者，后读者会把诊断挂到错误文件。
2. **干净文件不缓存**：缓存回写依赖 `results.get(storeRel)`，无诊断的文件没有 group → 永不写条目 → 每次全量重扫，增量能力形同虚设（[pipeline.ts](../../../packages/lintsight-cli/src/pipeline.ts) 缓存回写段）。
3. **图规则只接收 miss 文件**：引擎输入是 `misses.map(m => m.scanRel)`。热扫时环内文件若命中缓存，引擎看不到边表 → 已有环漏报；断环后旧缓存里的环诊断继续存在 → 陈旧误报。
4. **缓存键不含 tsconfig**：`tsconfig.json`（`paths` 别名、type-aware 语义）变化不会击穿缓存。
5. **条目写入非原子**：直接 `writeFile` 到最终路径；并发进程/并发 run 下读者可能读到半截 JSON（当前按 miss 兜底，但不满足矩阵第 6 组「同 key 并发原子性」）。
6. **引擎降级会毒化缓存**：引擎诊断与 M1 诊断混存；引擎崩溃时空结果被写进条目，后续命中将永久缺失引擎诊断。

旧实现已有键敏感性、条目 roundtrip、config 击穿、miss→hit、`--fix` 禁用等用例，但缺少 8 组矩阵中的路径归属、空结果缓存、文件删除、图规则冷热、tsconfig 击穿与并发原子性。

## 目标与非目标

- 目标：
  - 缓存键包含**文件路径**（项目根相对 POSIX）与 **tsconfig 内容指纹**，连同既有 engine/config/plugin 指纹；
  - **空结果也缓存**（干净文件写空数组），命中判定用 `entry !== null` 而非数组真值；
  - **引擎诊断一律不缓存**，每轮按当前扫描文件集全量 pass（计划允许的「图规则全量 pass 或标不可缓存」），保证图规则与文件集/别名变化的冷热等价；
  - 缓存条目 v1 → v2（只存 M1/oxlint 诊断），旧条目一次性 miss，fail-open 重扫；
  - 条目写入改为**临时文件 + rename** 原子发布；
  - 8 组矩阵用例全部落在 `cache.test.ts`，并附冷/热报告 diff 为空的证据；
  - `PipelineResult` 增加内部 `cache` 统计（enabled/hits/misses），供测试与排障，不进报告 JSON。
- 非目标（明确不做，防止范围蔓延）：
  - 不做 scanner 变更集、反向依赖影响面、增量调度（M5 G5）；
  - 不做跨文件 taint / 函数摘要缓存（M5）；
  - 不做缓存裁剪、容量上限、远端缓存；
  - 不修 Vue 虚拟路径图身份（G15）——G1 的图规则用例只用 TS 文件，不宣称 Vue 环已修；
  - 不改诊断 schema、ruleId、message、指纹、SARIF、exit code；
  - 不改 M5/M6 范围，不动 H4/双跑对照的 `[!]` 状态。

## 方案选型

| 方案 | 做法 | 代价/风险 | 结论 |
| --- | --- | --- | --- |
| A. 扩展键并缓存引擎诊断 | 键加路径 + tsconfig + 文件集 + 依赖闭包；维护文件集/影响集 manifest，图规则命中时合并缓存结果 | 需要 manifest 与失效索引；删除/重命名、增删文件都要维护；M4 无跨文件 taint，收益低、复杂度高 | 否决（留给 M5 增量） |
| B. M1 按文件缓存 + 引擎全量 pass（推荐） | 缓存只存 oxlint 每文件诊断；键加路径与 tsconfig；引擎每轮接收**全部扫描单元**，结果不落缓存 | 热扫多一次 Rust 全量分析（sidecar 启动 + 10 万 LOC/s 量级）；引擎缺失时零成本 | **采纳** |
| C. 关闭缓存 | 删除缓存路径，靠 oxlint 自身速度 | 增量能力倒退，scanner 大仓场景不可接受 | 否决 |

推荐 B：正确性优先，语义最简——「跨文件/文件集相关结果不可按单文件缓存」被显式建模，而不是用不完整的键假装正确；引擎本身是快速 sidecar，热扫成本可控（bench 为 `--no-cache` 冷扫口径，不受影响）。

## 影响面清单

- 代码面：
  - `packages/lintsight-cli/src/cache.ts`（键、条目 v2、原子写、插件路径解析、tsconfig 指纹）
  - `packages/lintsight-cli/src/pipeline.ts`（缓存探测/回写、M1 与引擎分组、引擎全量输入、cache 统计）
  - `packages/lintsight-cli/src/engine-bridge.ts`（抽出 `discoverTsconfigs`，`resolveTsPaths` 复用发现结果）
- 契约面：
  - 缓存键格式（引擎内部）；缓存条目 v1 → v2（一次性全量重扫）
  - 诊断 JSON / SARIF / 指纹 / exit code：**无变化**
  - scanner 调用契约：**无变化**
  - `PipelineResult` 增加内部字段 `cache`（TypeScript API，不序列化进报告）
- 文档面：
  - `docs/upgrade/v0.1/execution-todo.md`（G1 状态与证据）
  - `.agents/memory/decisions.md`（新增 D11：M4 引擎诊断不缓存）
  - 本 change 三层文档
- 测试面：
  - `packages/lintsight-cli/test/cache.test.ts` 新增 8 组矩阵
  - `packages/lintsight-cli/test/fix.test.ts`：临时文件残留断言收窄为虚拟块文件名正则（干净文件空结果入缓存后 `.lintsight-cache/` 属预期产物）
  - 回归：`closed-loop.test.ts`、`report-snapshot.test.ts`、`engine-bridge.test.ts`、`ignore.test.ts`

## Breaking Changes

- **缓存条目版本 v1 → v2**：旧条目全部视为 miss，首次扫描全量重跑；fail-open，无用户可见错误，不改变报告内容。
- **缓存键加入路径与 tsconfig**：同内容不同路径不再共享条目；config/tsconfig 变化立即击穿。
- **热扫报告可能比之前多出引擎诊断**：旧实现热扫跳过引擎；新实现每轮全量引擎 pass。这是修复（与冷扫一致），不是规则面变化；ruleId/message/指纹不变。
- 无规则文案、messageId、指纹、severity、默认启用面变化。

## 验收标准

- 8 组矩阵测试全部通过（测试名见 design.md §测试计划）：
  1. 同内容不同路径归属正确；
  2. 干净文件空结果命中；
  3. 文件删除后不读旧条目；
  4. config/plugin/engine 版本变化击穿；
  5. `--no-cache` 与 cache 冷/热诊断集合一致；
  6. 同 key 并发写入原子性；
  7. 图规则（成环/断环/加文件）冷热等价；
  8. tsconfig 变更冷热等价。
- 冷/热报告 `JSON.stringify` 相等（测试断言）；引擎可用时图规则冷/热条数一致。
- G1 相关命令：`bun run test`、`cargo test --release --manifest-path crates/lintsight-engine/Cargo.toml`、`bun run lint`、`bun run format:check` 全部通过并附输出摘要；矩阵强制门禁 `REQUIRE_ENGINE=1` 下引擎用例不得 skip。
- 仓级 `bun run corpus:check`：本次走 `cache:false`，与缓存改动无因果关系；当前 FAIL 属既有基线陈旧（基线 `52b03db`，后续规则提交未重建），归 G3。**G1 不以该项收口**，但按验收纪律 G1 暂记 `[~]`，待 G3 重建基线重跑或用户明确批准例外后再置 `[x]`。
- 证据写入 `execution-todo.md` G1 行：测试名、复现命令、冷/热 diff 结果；不提前宣称 M4 完成。
