/**
 * T1.17 性能基准：万行语料冷扫 <10s 校准 + 回退 >15% 门禁（M1 验收 / NFR）。
 *
 * 用法：
 *   bun run bench          # 生成语料 → hyperfine 冷扫 → 与基线对比（>15% 回退 exit 1）
 *   bun run bench -- --save  # 把本轮结果存为基线（scripts/bench-baseline.json，提交 git）
 *
 * 语义：--no-cache 冷扫（缓存命中会让时间塌缩，测的是扫描内核）；
 * 语料确定性生成（100 文件 × ~100 行 ≈ 1 万行），含固定坏味道让规则面真实工作。
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'

const ROOT = new URL('../', import.meta.url).pathname
const CORPUS_DIR = path.join(ROOT, '.bench-corpus')
const BASELINE_PATH = path.join(ROOT, 'scripts', 'bench-baseline.json')
const BENCH_JSON = path.join(ROOT, '.lintsight-cache', 'bench.json')

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
  lines: number
  files: number
  commit: string
  date: string
}

async function main() {
  const save = process.argv.includes('--save')
  const lines = await ensureCorpus()
  console.log(
    `bench corpus: ${FILES} files, ~${lines} lines → cold scan (--no-cache)`
  )

  const cmd = `bun run packages/lintsight-cli/src/cli.ts --format json --no-cache .bench-corpus >/dev/null`
  // --ignore-failure：语料含坏味道 → exit 1（有诊断语义，非运行失败）
  const proc = Bun.spawn(
    [
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
      cmd
    ],
    { cwd: ROOT, stdout: 'inherit', stderr: 'inherit' }
  )
  if ((await proc.exited) !== 0) {
    console.error('bench: hyperfine 运行失败（brew install hyperfine）')
    process.exit(2)
  }

  const hf = JSON.parse(await readFile(BENCH_JSON, 'utf8')) as {
    results: { mean: number; stddev: number; min: number; max: number }[]
  }
  const r = hf.results[0]
  const meanMs = r.mean * 1000
  console.log(
    `mean=${meanMs.toFixed(0)}ms  min=${(r.min * 1000).toFixed(0)}ms  max=${(r.max * 1000).toFixed(0)}ms  ±${(r.stddev * 1000).toFixed(0)}ms`
  )

  // 硬门禁：万行库 <10s（M1 验收口径）
  if (meanMs >= 10_000) {
    console.error(`bench: FAIL — ${meanMs.toFixed(0)}ms ≥ 10000ms（万行库 <10s）`)
    process.exit(1)
  }
  console.log('bench: 万行库 <10s 达标')

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
      lines,
      files: FILES,
      commit,
      date: new Date().toISOString().slice(0, 10)
    }
    await writeFile(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`)
    console.log(`bench: baseline saved → scripts/bench-baseline.json`)
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
}

await main()
