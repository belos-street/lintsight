# Design: G1 缓存正确性（路径 / 空结果 / 图规则冷热等价）

> change-id：`20261030-cache-correctness` · 日期：`2026-10-30`

## 技术设计

### 1. 缓存键 v2（路径 + tsconfig + 既有指纹）

```text
key = sha256(JSON.stringify([
  'entry@2',
  engineFp,
  configFp,
  pluginFp,
  `path@${storeRel}`,
  `content@${contentHash}`
]))
```

> 用 JSON 数组序列化而不是 `|` 拼接：路径/内容中出现 `|` 等字符时不会产生成分边界歧义。

- `storeRel`：诊断归属文件的项目根相对 POSIX 路径；`.vue` 用**原始 `.vue`**（不是虚拟块路径），与缓存条目里的 `file` 口径一致。
- `contentHash`：原始文件内容 SHA-256（`.vue` 仍取原文件；虚拟块由原文件确定性生成）。
- `engineFp`（沿用现有组合）：`lintsight@<版本>|oxlint@<版本>|engine@<bin 内容哈希前 16 位 | none>|contract@<CONTRACT_VERSION>`。`entry@2` 作为键前缀盐，与条目版本双保险。
- `configFp`：按固定顺序拼接 `<label>@<sha256 | ->`：
  1. `lintsight.config.json`（cwd 自动发现形态）；
  2. `cwd/.oxlintrc.json`（oxlint 自动发现形态）；
  3. 生成配置（`.lintsight-cache/oxlintrc.json`，若本轮存在）；
  4. **本轮发现的全部 tsconfig**：`<root 相对 POSIX 路径>@<内容哈希>`，按路径排序。
- `pluginFp`：两个 oxlintrc 的 `jsPlugins` 并集，逐项解析为绝对路径后 `<absPath>@<sha256 | missing>`，按路径排序。

> 说明：`tsconfig` 通过 `configFp` 参与键。它既影响引擎别名解析，也影响 `--type-aware`（tsgolint）诊断，不能只当作引擎成分。

### 2. 缓存条目 v2（只存 M1 诊断）

```ts
// .lintsight-cache/cache/<key>.json
{ v: 2, engine: string, diagnostics: LintsightDiagnostic[] }
```

- `diagnostics` = **仅 oxlint/JS 轨道**（缓存命中时 `file` 已是 `storeRel`）。
- 读取校验：`v === 2 && engine === ctx.engine && Array.isArray(diagnostics)`；任一不满足 → miss。
- **空数组是合法命中**：调用方用 `entry !== null` 判定，禁止 `if (entry)` 风格（数组恒真但空数组语义不同）。
- v1 条目（引擎诊断混存）全部 miss；不主动删除，磁盘陈旧条目不影响正确性（fail-open，见风险 5）。

### 3. 原子写入

```ts
const tmp = `${target}.${process.pid}.${seq++}.tmp`
await writeFile(tmp, json)
await rename(tmp, target)          // 同目录 rename：POSIX 原子；Windows uv_fs_rename 走 MoveFileExW 替换
```

- 任一步失败 → 删除 tmp（尽力而为）+ debug 日志，不抛错（缓存写失败不影响扫描）。
- 并发写同一 key：rename 是原子的，但**不保证最后写者胜出**；Windows 共享冲突下个别写入会重试 3 次后 fail-open 丢弃。读者只会看到「旧完整文件」或「新完整文件」，不会读到半截 JSON；同 key 意味着内容/配置一致，旧条目与新条目语义等价，丢写无害。
- tmp 名含 pid + 进程内自增序号，避免并发进程互相覆盖 tmp。

### 4. 插件路径解析修正

现有 `jsPluginPaths` 返回 oxlintrc 内的原始字符串，`sha256File` 以**进程 cwd** 解析——手写 `.oxlintrc.json` 里的相对路径（如 `"./plugin.js"`）会被静默算作 `missing`，改插件内容不击穿缓存。修正：

```ts
interface PluginRef { oxlintrcDir: string; entry: string }
// entry 为相对路径 → path.resolve(oxlintrcDir, entry)；绝对路径原样
```

生成配置里的插件路径本来就是绝对路径，行为不变；手写配置获得正确语义（与 oxlint 自身「相对配置文件目录」一致）。

### 5. tsconfig 发现与指纹

从 `engine-bridge.ts` 抽出发现逻辑，避免 cache 初始化与 `resolveTsPaths` 两次全树 IO：

```ts
export function discoverTsconfigs(cwd: string, roots: string[] = []): string[]
export async function resolveTsPaths(
  cwd: string,
  roots?: string[],
  discovered?: string[]
): Promise<TsPathMapping[] | null>
```

- `discoverTsconfigs` 完全复用现有边界：cwd 根 `tsconfig.json` 恒含；目录输入递归（深度 32，上限 500）；跳过 `node_modules/.git/.lintsight-cache/dist/build/coverage/.next/.nuxt` 与隐藏目录；文件输入不递归。
- pipeline 在 `initCache` 之前调用一次 `discoverTsconfigs(cwd, inputs)`，把结果传给 `initCache({ tsconfigFiles })`；随后 `resolveTsPaths(cwd, inputs, tsconfigs)` 复用同一列表。
- 指纹取每个文件的字节级 SHA-256（JSONC 注释变化也算变化，宁可多扫不可陈旧）。
- 已知边界（沿用现状，不在 G1 扩）：不解析 `extends` 继承链；超过 500 个 tsconfig 的巨型仓只覆盖前 500 个。

### 6. Pipeline 数据流

```text
collectFiles
  → virtualizeVue（全部 .vue 生成虚拟块，命中与否都一样）
  → discoverTsconfigs
  → initCache({ cwd, oxlintrcPath, lintsightVersion, engineBin, tsconfigFiles })
  → 逐单元探测：hash(原文件) + key(storeRel, hash) → readCacheEntry
       hit  → m1Groups.set(storeRel, entry)
       miss → misses.push({ scanAbs, scanRel, storeRel, key })
  → oxlint(misses)                        // 命中文件不重扫
  → normalizeDiagnostics → m1Groups      // M1 分组
  → 回写缓存：每个 miss 且 key 非空 → writeCacheEntry(key, m1Groups.get(storeRel) ?? [])
  → runEngine(全部单元的 scanRel)          // 图规则/引擎规则全量 pass，结果不缓存
  → engine 诊断按 unitMap(scanRel → storeRel) 归组，与 M1 合并
  → suppressSuperseded → sortDiagnostics → summary / exit code
```

关键点：

1. **引擎输入改为全量**：`runEngine` 从 `if (misses.length > 0)` 块移出，始终传 `units.map(u => scanRel)`；`runEngine` 自身在二进制缺失时立即返回，零成本。这样图规则看到的边表 = 当前扫描文件集，与冷扫一致；断环后不会复用旧环诊断。
2. **map 分离**：`missMap` 仅用于 oxlint 输出回映射（oxlint 只扫 miss）；新增 `unitMap`（全部单元）用于引擎诊断回映射。
3. **写缓存只用 M1 分组**：不再写 `results.get(storeRel)`（那是 M1 + 引擎的合并组）。干净文件写 `[]`——这是矩阵第 2 组的修复点。
4. **引擎降级不毒化**：引擎结果不落盘，因此 `degraded=true` 时写 M1 条目是安全的；下一轮引擎恢复后重新计算引擎诊断（矩阵第 4 组附带用例）。
5. **抑制顺序不变**：`suppressSuperseded` / `suppressVueUnusedVars` 仍在合并后执行；缓存写的是抑制前的原始 M1 诊断，下一轮会重新应用抑制，冷/热一致。
6. **`--fix` / `--no-cache` 语义不变**：均完全禁用缓存读写；fix 仍全量扫描并回写 `.vue`。
7. **可观测性**：`PipelineResult` 增加
   ```ts
   cache?: { enabled: boolean; hits: number; misses: number }
   ```
   仅 TypeScript 内部 API，不进 `LintsightReport`，不改变 JSON/SARIF。

### 7. 边界与取舍说明（对齐计划 §7 G1）

- 计划允许「图规则全量 pass **或** 标不可缓存」；本设计选择**全量 pass + 引擎结果整体不缓存**。因此：
  - **文件集**无需进缓存键：引擎每轮按当前文件集重算；
  - **依赖闭包/影响集**在 M4 没有跨文件 taint/摘要，唯一跨文件消费者是引擎，已被全量重算覆盖；
  - M5 引入跨文件 taint 缓存时，再补摘要/影响集键，不在本轮预留半成品。
- 不做缓存裁剪：文件删除后条目留在磁盘上，但不会被任何单元读取（矩阵第 3 组的语义是「不命中/不产出陈旧诊断」，不是物理删除）。

## 涉及文件清单

- 改动：`packages/lintsight-cli/src/cache.ts`
- 改动：`packages/lintsight-cli/src/pipeline.ts`
- 改动：`packages/lintsight-cli/src/engine-bridge.ts`
- 改动（测试）：`packages/lintsight-cli/test/cache.test.ts`
- 改动（测试）：`packages/lintsight-cli/test/fix.test.ts`（临时文件残留断言收窄为虚拟块文件名正则；缓存目录不再误判为残留）
- 改动（文档）：`docs/upgrade/v0.1/execution-todo.md`
- 改动（文档）：`.agents/memory/decisions.md`
- 新增：`docs/changes/20261030-cache-correctness/{proposal,design,tasks}.md`
- 删除：无
- Rust 代码：无改动

## 规则 / 引擎影响

- 规则 ID、category、severity、confidence、CWE/OWASP：无变化。
- 检测层：`none` / `local` / `taint` 均不变。
- source/sink/sanitizer/propagator 表：无变化。
- 注册表 / builtin-mapping / 预设：无变化。
- 指纹 / message / golden / SARIF：无变化。热扫时引擎诊断重新出现属于「漏报修复」，不是文案或规则面变化。
- 引擎调用面：从「仅 miss 文件」改为「全部扫描单元」；`summary.files` 语义不变（引擎自己统计）。

## 测试计划

8 组矩阵全部落在 `packages/lintsight-cli/test/cache.test.ts`：

| # | 矩阵项 | 测试名（新增/修改） | 断言要点 |
| --- | --- | --- | --- |
| 1 | 同内容不同路径 | `同内容不同路径：诊断归属各自文件，冷/热一致` | 两个内容相同的坏文件，各自 `file` 正确、条数 2；二轮命中后仍为 2 且归属不变 |
| 2 | 干净文件命中（空结果缓存） | `干净文件空结果入缓存：二轮全 hit` | 首轮 `cache.misses=2`；二轮 `hits=2/misses=0`；诊断集合不变 |
| 3 | 文件删除 | `文件删除后不命中旧条目：诊断不含已删文件` | 删 `b.ts` 后重跑只报 `a.ts`；不出现 `b.ts` 的陈旧诊断；exit 仍按现存 error 计算 |
| 4a | config 变化 | `配置变更击穿缓存：.oxlintrc.json 规则集变化 → 重新扫描` | 规则集变化 → 新键 → 诊断随配置更新 |
| 4b | engine 版本/指纹变化 | `引擎版本指纹变化：lintsightVersion / engine bin 内容 → 新键` | 单元级 `initCache` + `createCacheKey`：版本或二进制内容变化 → 键不同 |
| 4c | plugin 变化 | `插件产物内容变化击穿：jsPlugins 相对路径按配置目录解析` + `手写 .oxlintrc.json 的 jsPlugins 相对路径：oxlint 实际加载` | 改插件文件内容 → 指纹/键变化、相对路径不再算 `missing`；端到端确认 oxlint 相对配置目录解析 |
| 4d | 引擎降级恢复 | `引擎降级期间写 M1 缓存，恢复后引擎诊断仍出现`（skipIf 无引擎） | `OXLINT_ENGINE_BIN` 指向不存在路径 → `degraded=true`；恢复后同项目热扫出现 `lintsight-engine/no-eval` |
| 5 | `--no-cache` 与 cache 一致 | `--no-cache 与 cache 冷/热诊断集合一致` | 冷扫 / 热扫 / `cache:false` 三者 `JSON.stringify(report.diagnostics)` 相等 |
| 6a | 同 key 并发原子性 | `同 key 并发写入：条目始终完整可解析` | 8 个并发 `writeCacheEntry`（不同载荷）+ 并发读：每次读到完整数组且属于某一完整版本，无 null/半截 |
| 6b | 并发 pipeline | `并发 runPipeline：两轮结果一致且缓存可读` | 同项目两个 `Promise.all` run → 诊断相等；随后第三轮可正常读缓存 |
| 7 | 图规则冷热等价 | `图规则冷热等价：成环 / 断环 / 加文件（importCycles）`（skipIf 无引擎） | a↔b 冷=热=2；断环后冷=热=0；加文件成三节点环冷=热=3；`cache:false` 同结果 |
| 8a | tsconfig 指纹 | `tsconfig 内容变化 → config 指纹变化` | 单元级：同一 `lintsightVersion` 下改 tsconfig 内容 → `config` 与键不同 |
| 8b | tsconfig 变更冷热等价 | `tsconfig 别名变化冷热等价：别名解析成环`（skipIf 无引擎） | 无 tsconfig 时 `@/a` 不解析 → 0 环；加 `paths` 后（不改源码）热扫得到 2 环；`cache:false` 同结果 |

前置门禁：

- `REQUIRE_ENGINE=1`：`cache.test.ts` 顶部前置用例断言引擎产物存在；CI 设置该变量，无 cargo release 产物直接 fail，不允许图规则矩阵静默 skip。

回归命令与范围：

- `bun run build:rules && bun test packages/lintsight-cli/test/cache.test.ts`
- `REQUIRE_ENGINE=1 bun test packages/lintsight-cli/test/cache.test.ts`（Linux/macOS；Windows 用 `$env:REQUIRE_ENGINE='1'; bun test ...`）
- `bun run test`（全量；含 `closed-loop` / `report-snapshot` / `engine-bridge` / `ignore` / `fix`）
- `cargo test --release --manifest-path crates/lintsight-engine/Cargo.toml`（无 Rust 改动，按完工自检执行）
- `bun run lint` / `bun run format:check`
- `bun run corpus:check`：本 change 走 `cache:false`，与缓存路径无关；当前 FAIL 归 G3 基线重建，不作为 G1 收口条件。

### 证据复现命令（2026-10-30）

```powershell
# 1) 冷 / 首次 cache / 热扫 JSON 逐字节一致（PowerShell，Windows）
Remove-Item -Recurse -Force .lintsight-cache -ErrorAction SilentlyContinue
$cold="$env:TEMP\lintsight-nocache.json"; $first="$env:TEMP\lintsight-cold.json"; $hot="$env:TEMP\lintsight-hot.json"
bun run cli -- fixtures/ts --format json --no-cache --output $cold > $null
bun run cli -- fixtures/ts --format json --output $first > $null
bun run cli -- fixtures/ts --format json --output $hot > $null
Compare-Object (Get-Content -Raw $cold) (Get-Content -Raw $first)   # 空
Compare-Object (Get-Content -Raw $first) (Get-Content -Raw $hot)    # 空

# 2) 100 文件热扫计时（临时项目，100 × 5 行）
$d = Join-Path $env:TEMP 'lintsight-100'
Remove-Item $d -Recurse -Force -ErrorAction SilentlyContinue; New-Item -ItemType Directory $d | Out-Null
1..100 | ForEach-Object {
  $c = "export function f$_(a: number): number {`n  const x = a + 1`n  console.log(x)`n  return x`n}`n"
  Set-Content -LiteralPath (Join-Path $d "f$_.ts") -Value $c -NoNewline
}
$out = Join-Path $env:TEMP 'lintsight-100.json'
$sw=[Diagnostics.Stopwatch]::StartNew(); bun run cli -- $d --format json --output $out > $null; $t1=$sw.ElapsedMilliseconds
$sw.Restart(); bun run cli -- $d --format json --output $out > $null; $t2=$sw.ElapsedMilliseconds
Write-Output "cold-ish=$t1 ms, warm=$t2 ms"   # 实测 309ms / 109ms
```

## 风险与已知坑

1. **热扫成本**：引擎每轮全量 pass。bench（`--no-cache` 冷扫）不受影响；需在验收时补一次百文件热扫计时，确认仍满足 M4 退出条件「百文件增量 <1s」。若超标，优先缩引擎启动开销，不回退正确性设计。
2. **Windows rename 语义**：依赖 libuv `uv_fs_rename`（MoveFileExW 替换目标）。6a 用例在 Windows 本地可能观察到 `EPERM` 重试后 fail-open 丢弃写入；测试只断言读者看到完整条目，不保证最后写者胜出（同 key 内容等价，丢写无害）。
3. **tsconfig 边界**：不解析 `extends`、500 文件上限。超出范围的变化可能不击穿缓存——与现状一致，文档标注，G13 调整 root 语义时复核。
4. **无项目配置时的自动发现**：cwd 无 `lintsight.config.json`/`.oxlintrc.json` 时，oxlint 可能向上发现祖先配置，缓存指纹只覆盖 cwd 两个固定路径与生成配置。已知边界，G13 明确 `--root > --config > cwd` 后收敛。
5. **v1 条目残留**：版本 bump 后旧条目不被读取但占磁盘；不做主动清理（fail-open，删除由用户/后续维护处理）。
6. **`.vue` 虚拟块生成规则变更**：缓存键的 `lintsightVersion` 以 CLI 包版本兜底；若 processor 独立发版且 CLI 未 bump，可能短暂陈旧，G14 单一版本源后消除。
7. **不得越界**：G1 不修 Vue 图身份（G15）、不修重复输入（G16）、不做跨文件 taint 缓存（M5）；矩阵第 7 组只用 TS fixture，验收口径不得写成 Vue 环通过。
8. **`.oxlintrc.json` 的 `extends` 继承链未纳入指纹**：生成配置不走 `extends`，手写配置若通过 `extends` 引用上游规则集，上游文件变化不会击穿缓存；与 tsconfig `extends` 同属已知边界，G13 显式化配置根时复核。
