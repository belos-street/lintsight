/**
 * T1.17/T2.6 性能基准：万行语料冷扫 <10s 校准 + 回退 >15% 门禁（M1/M2 验收 / NFR）。
 *
 * 用法：
 *   bun run bench          # 生成语料 → hyperfine 冷扫（CLI + 引擎直测）→ 与基线对比
 *   bun run bench -- --save  # 把本轮结果存为基线（scripts/bench-baseline.json，提交 git）
 *
 * 语义：--no-cache 冷扫（缓存命中会让时间塌缩，测的是扫描内核）；
 * 语料确定性生成（100 文件 × ~100 行 ≈ 1 万行），含固定坏味道让规则面真实工作。
 * T2.6 起：M2 引擎直测纳入门禁（NFR-1 预算 15 万 LOC/s → 万行 ≈67ms）。
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'

const ROOT = new URL('../', import.meta.url).pathname
const CORPUS_DIR = path.join(ROOT, '.bench-corpus')
const BASELINE_PATH = path.join(ROOT, 'scripts', 'bench-baseline.json')
const BENCH_JSON = path.join(ROOT, '.lintsight-cache', 'bench.json')
const ENGINE_BIN = path.join(
  ROOT,
  'crates/lintsight-engine/target/release/lintsight-engine'
)

const FILES = 100
const FUNCS_PER_FILE = 5 // 每函数 ~21 行 → ~105 行/文件 ≈ 万行总量

function genFile(fileIdx: number): string {
  let out = `// bench corpus file ${fileIdx}（确定性生成，勿手改）\n`
  for (let f = 0; f < FUNCS_PER_FILE; f++) {
    const i = `${fileIdx}_${f}`
    out += `export function fn_${i}(a: number, b: number): number {
  let x = a + b
  if (x > 10) {
    for (let j = 0; j < x; j++) {
      if (j % 2 === 0) { x += j } else { x -= 1 }
    }
  } else {
    while (x < 100) { x = x * 2 + 1 }
  }
  try {
    switch (x % 3) {
      case 0: x = x + 1; break
      case 1: x = x - 1; break
      default: x = x * 2
    }
  } catch {
  }
  const tpl = \`fn_${i}: \${x}\`
  console.log(tpl)
  return x
}
`
  }
  return out
}

async function ensureCorpus(): Promise<number> {
  await mkdir(CORPUS_DIR, { recursive: true })
  let lines = 0
  const writes = Array.from({ length: FILES }, (_, i) => {
    const content = genFile(i)
    lines += content.split('\n').length
    return writeFile(path.join(CORPUS_DIR, `bench_${i}.ts`), content)
  })
  await Promise.all(writes)
  return lines
}

interface Baseline {
  meanMs: number
  /** M2 引擎直测（T2.6 起）；旧基线无此字段 → 跳过引擎回退检查 */
  engineMeanMs?: number
  lines: number
  files: number
  commit: string
  date: string
}

/** hyperfine 单次测量（hyperfine 失败直接抛错终止）；stdinFile 走 shell 重定向
 *（本机 hyperfine 版本不支持 --stdin 参数） */
async function measure(
  label: string,
  cmd: string,
  opts: { stdinFile?: string } = {}
): Promise<number> {
  const full = opts.stdinFile ? `${cmd} < ${opts.stdinFile}` : cmd
  const args = [
    'hyperfine',
    '--warmup',
    '1',
    '--runs',
    '5',
    '--ignore-failure',
    '--export-json',
    BENCH_JSON,
    '--style',
    'basic',
    full
  ]
  const proc = Bun.spawn(args, {
    cwd: ROOT,
    stdout: 'inherit',
    stderr: 'inherit'
  })
  if ((await proc.exited) !== 0) {
    throw new Error('bench: hyperfine 运行失败（brew install hyperfine）')
  }
  const hf = JSON.parse(await readFile(BENCH_JSON, 'utf8')) as {
    results: { mean: number; stddev: number; min: number; max: number }[]
  }
  const r = hf.results[0]
  console.log(
    `${label}: mean=${(r.mean * 1000).toFixed(0)}ms  min=${(r.min * 1000).toFixed(0)}ms  max=${(r.max * 1000).toFixed(0)}ms  ±${(r.stddev * 1000).toFixed(0)}ms`
  )
  return r.mean * 1000
}

async function main() {
  const save = process.argv.includes('--save')
  const lines = await ensureCorpus()
  console.log(
    `bench corpus: ${FILES} files, ~${lines} lines → cold scan (--no-cache)`
  )

  // —— CLI 全管线（M1 面）——
  const meanMs = await measure(
    'cli',
    'bun run packages/lintsight-cli/src/cli.ts --format json --no-cache .bench-corpus >/dev/null'
  )

  // 硬门禁：万行库 <10s（M1 验收口径）
  if (meanMs >= 10_000) {
    console.error(`bench: FAIL — ${meanMs.toFixed(0)}ms ≥ 10000ms（万行库 <10s）`)
    process.exit(1)
  }
  console.log('bench: 万行库 <10s 达标')

  // —— M2 引擎直测（T2.6）：NFR-1 预算 15 万 LOC/s → 万行 ≈67ms + spawn 开销 ——
  let engineMeanMs: number | null = null
  if (await Bun.file(ENGINE_BIN).exists()) {
    await writeFile(
      path.join(CORPUS_DIR, 'engine-input.json'),
      JSON.stringify({
        files: Array.from({ length: FILES }, (_, i) => `bench_${i}.ts`)
      })
    )
    engineMeanMs = await measure(
      'engine',
      `${ENGINE_BIN} --root .bench-corpus`,
      { stdinFile: '.bench-corpus/engine-input.json' }
    )
    // 硬门禁：引擎直测 <1s（NFR-1 预算 67ms 的 15 倍裕度，拦截量级回退）
    if (engineMeanMs !== null && engineMeanMs >= 1_000) {
      console.error(
        `bench: FAIL — engine ${engineMeanMs.toFixed(0)}ms ≥ 1000ms（NFR-1 万行预算 67ms）`
      )
      process.exit(1)
    }
    const locPerS = Math.round((lines / engineMeanMs!) * 1000)
    console.log(
      `bench: engine ${locPerS.toLocaleString()} LOC/s（NFR-1 预算 150,000）`
    )
    console.log('bench: 引擎直测 <1s 达标')
  } else {
    console.log(
      'bench: 引擎二进制缺失（cargo build --release），跳过 M2 引擎门禁'
    )
  }

  let commit = 'unknown'
  try {
    const p = Bun.spawn(['git', 'rev-parse', '--short', 'HEAD'], { cwd: ROOT })
    commit = (await new Response(p.stdout).text()).trim() || 'unknown'
    await p.exited
  } catch (e) {
    // 非 git 环境容忍（commit 仅用于基线溯源标注）
    console.log(`bench: commit 解析跳过（${String(e)}）`)
  }

  if (save) {
    const baseline: Baseline = {
      meanMs: Math.round(meanMs),
      ...(engineMeanMs !== null ? { engineMeanMs: Math.round(engineMeanMs) } : {}),
      lines,
      files: FILES,
      commit,
      date: new Date().toISOString().slice(0, 10)
    }
    await writeFile(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`)
    console.log('bench: baseline saved → scripts/bench-baseline.json')
    return
  }

  let baseline: Baseline | null = null
  try {
    baseline = JSON.parse(await readFile(BASELINE_PATH, 'utf8')) as Baseline
  } catch {
    console.log('bench: 无基线（bun run bench -- --save 建立）；本轮仅校准 <10s 门禁')
    return
  }

  const delta = (meanMs - baseline.meanMs) / baseline.meanMs
  const pct = (delta * 100).toFixed(1)
  console.log(`baseline=${baseline.meanMs}ms (commit ${baseline.commit})  Δ=${pct}%`)
  if (delta > 0.15) {
    console.error(
      `bench: FAIL — 性能回退 ${pct}% > 15% 门禁（baseline commit ${baseline.commit}）`
    )
    process.exit(1)
  }
  console.log('bench: 回退门禁通过')

  // 引擎回退检查（T2.6；旧基线无 engineMeanMs → 跳过）
  if (engineMeanMs !== null && baseline.engineMeanMs !== undefined) {
    const edelta = (engineMeanMs - baseline.engineMeanMs) / baseline.engineMeanMs
    const epct = (edelta * 100).toFixed(1)
    console.log(
      `engine baseline=${baseline.engineMeanMs}ms  Δ=${epct}%`
    )
    if (edelta > 0.15) {
      console.error(
        `bench: FAIL — 引擎性能回退 ${epct}% > 15% 门禁（baseline commit ${baseline.commit}）`
      )
      process.exit(1)
    }
    console.log('bench: 引擎回退门禁通过')
  }
}

await main()
