/**
 * T1.18 语料库基线检查：同步语料 → 全量扫描 → 双报率 0 断言 → 指纹级基线 diff。
 *
 * 用法：
 *   bun run corpus:check            # 扫描 + 双报门禁 + 与 corpus/baseline-v0.json 对比（漂移 exit 1）
 *   bun run corpus:check -- --save  # 把本轮 digest 存为基线（入库，作为后续 diff 的锚点）
 *
 * 基线漂移 = 评审信号：新增/消失诊断必须逐条评审后显式 --save 重建（version-policy 同款纪律）。
 */
import path from 'node:path'
import { writeFile, readFile } from 'node:fs/promises'
import pkg from '../packages/lintsight-cli/package.json'
import { runPipeline } from '../packages/lintsight-cli/src/pipeline'
import { syncAll, ROOT } from './corpus-sync'
import {
  buildDigest,
  detectDoubleReports,
  diffDigest,
  type CorpusDigest
} from './corpus-lib'

const BASELINE_PATH = path.join(ROOT, 'corpus', 'baseline-v0.json')

interface BaselineFile {
  engine: string
  corpus: { name: string; tag: string }[]
  digest: CorpusDigest
  date: string
}

async function main() {
  const save = process.argv.includes('--save')
  await syncAll()

  const result = await runPipeline(['corpus/repos'], {
    cwd: ROOT,
    logLevel: 'error',
    cache: false // 基线必须冷扫：与缓存命中路径解耦
  })
  if (!result.report) {
    console.error(`corpus: 扫描失败 — ${result.error}`)
    process.exit(2)
  }
  const diagnostics = result.report.diagnostics
  console.log(
    `corpus scan: ${result.report.files} file(s), ${diagnostics.length} diagnostic(s)`
  )

  // —— 双报率 0 门禁（FR-407）——
  const doubleReports = detectDoubleReports(diagnostics)
  if (doubleReports.length > 0) {
    console.error(`corpus: FAIL — 双报事件 ${doubleReports.length} 起（门禁 = 0）：`)
    for (const e of doubleReports.slice(0, 10)) {
      console.error(
        `  ${e.file}:${e.offset} → ${e.rules.map((r) => `${r.owner}:${r.ruleId}`).join(' + ')}`
      )
    }
    process.exit(1)
  }
  console.log('corpus: 双报率 = 0 ✓')

  // —— 基线对比 / 保存 ——
  const digest = buildDigest(diagnostics)
  if (save) {
    const manifest = JSON.parse(
      await readFile(path.join(ROOT, 'corpus', 'corpus.json'), 'utf8')
    ) as { repos: { name: string; tag: string }[] }
    const baseline: BaselineFile = {
      engine: `lintsight@${pkg.version}`,
      corpus: manifest.repos.map((r) => ({ name: r.name, tag: r.tag })),
      digest,
      date: new Date().toISOString().slice(0, 10)
    }
    await writeFile(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`)
    console.log(
      `corpus: baseline saved（${digest.total} diagnostics, ${digest.fingerprints.length} fingerprints）`
    )
    return
  }

  let baseline: BaselineFile
  try {
    baseline = JSON.parse(await readFile(BASELINE_PATH, 'utf8')) as BaselineFile
  } catch {
    console.log('corpus: 无基线（bun run corpus:check -- --save 建立）')
    return
  }

  const diff = diffDigest(baseline.digest, digest)
  if (diff.unchanged) {
    console.log('corpus: 基线一致 ✓')
    return
  }

  console.error('corpus: FAIL — 诊断面漂移（评审后 corpus:check -- --save 重建基线）：')
  for (const [rule, delta] of Object.entries(diff.byRuleDelta)) {
    console.error(`  ${rule}: ${delta > 0 ? '+' : ''}${delta}`)
  }
  console.error(
    `  new=${diff.newFingerprints.length} gone=${diff.goneFingerprints.length}（指纹级明细按需比对）`
  )
  process.exit(1)
}

await main()
