/**
 * juice-shop 逐挑战召回对照（FR-303 验收配套，M2.7 制度化）：
 * 官方挑战清单（challenges.yml）× 静态锚点 ↔ 自有规则诊断，逐挑战给出判定。
 *
 * 锚点来源：
 *   1. codefixes 自动映射（官方修复挑战片段，文件名内嵌挑战 key——语料库直采）
 *   2. EXTRA_ANCHORS（社区 writeup 公认的路由埋洞文件，v0.1 报告人工确认集）
 *
 * 判定口径：
 *   recalled         = 锚点文件中存在自有规则（lintsight/* / lintsight-engine/*）诊断
 *   pending-human    = 有锚点但零命中——漏报候选，需人工定性（规则面不覆盖 or 真漏报）
 *   no-static-anchor = 无静态可定位锚点（逻辑/动态/依赖 CVE 类），不计入召回分母
 *
 * 用法：bun run corpus:recall [--save]
 *   机器可读结果 → .lintsight-cache/corpus/recall-now.json；MD 对照表 → stdout
 */
import path from 'node:path'
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { ROOT, REPOS_DIR } from './corpus-sync'
import { runPipeline } from '../packages/lintsight-cli/src/pipeline'
import {
  mapCodefixes,
  parseChallengesYml,
  type JuiceChallenge
} from './corpus-lib'

const JUICE = path.join(REPOS_DIR, 'juice-shop')
const OUT_JSON = path.join(ROOT, '.lintsight-cache', 'corpus', 'recall-now.json')

/** 社区 writeup 公认的路由级埋洞锚点（v0.1 报告 §2 人工确认集）：
 * challengeKey → juice-shop 仓内相对路径。
 * login 三挑战（admin/bender/jim）与 unionSqlInjectionChallenge 同洞：
 * /rest/user/login 的 SQL 拼接（Sequelize.literal 内插 email）覆盖全部
 * 登录类 SQLi 挑战——no-sql-concat 在 routes/login.ts 单点命中。 */
const EXTRA_ANCHORS: Record<string, string[]> = {
  unionSqlInjectionChallenge: ['routes/login.ts'],
  loginAdminChallenge: ['routes/login.ts'],
  loginBenderChallenge: ['routes/login.ts'],
  loginJimChallenge: ['routes/login.ts'],
  dbSchemaChallenge: ['routes/search.ts'],
  ssrfChallenge: ['routes/profileImageUrlUpload.ts'],
  weirdCryptoChallenge: ['lib/insecurity.ts'],
  captchaBypassChallenge: ['routes/captcha.ts']
}

type Verdict = 'recalled' | 'pending-human' | 'no-static-anchor'

interface RecallRow {
  challenge: JuiceChallenge
  verdict: Verdict
  anchors: string[]
  /** recalled 时命中锚点文件的自有规则（去重排序） */
  rules: string[]
}

function isOwnRule(ruleId: string): boolean {
  // 自有规则面 = JS 轨道（lintsight/*）+ 引擎轨道（lintsight-engine/*）
  return (
    ruleId.startsWith('lintsight/') || ruleId.startsWith('lintsight-engine/')
  )
}

async function main() {
  if (!existsSync(JUICE)) {
    console.error('corpus:recall: juice-shop 未同步——先执行 bun run corpus:sync')
    process.exit(2)
  }

  const [challengesText, codefixes] = await Promise.all([
    readFile(path.join(JUICE, 'data', 'static', 'challenges.yml'), 'utf8'),
    readdir(path.join(JUICE, 'data', 'static', 'codefixes'))
  ])
  const challenges = parseChallengesYml(challengesText)
  const fixMap = mapCodefixes(
    codefixes
      .filter((f) => f.endsWith('.ts'))
      .map((f) => `data/static/codefixes/${f}`)
  )

  // 冷扫 juice-shop（锚点命中以本次诊断为准，确定性优先）
  const result = await runPipeline(['corpus/repos/juice-shop'], {
    cwd: ROOT,
    logLevel: 'error',
    cache: false
  })
  if (!result.report) {
    console.error(`corpus:recall: 扫描失败 — ${result.error}`)
    process.exit(2)
  }
  const diags = result.report.diagnostics
  // file → 自有规则集合（锚点匹配用）
  const rulesByFile = new Map<string, Set<string>>()
  for (const d of diags) {
    if (!isOwnRule(d.ruleId)) continue
    // 扫描报告 file = corpus/repos/juice-shop/<rel>，锚点为 juice-shop 仓内相对路径
    const prefix = 'corpus/repos/juice-shop/'
    const rel = d.file.startsWith(prefix) ? d.file.slice(prefix.length) : d.file
    const set = rulesByFile.get(rel) ?? new Set<string>()
    set.add(d.ruleId)
    rulesByFile.set(rel, set)
  }

  const rows: RecallRow[] = challenges.map((challenge) => {
    const anchors = [
      ...(fixMap.get(challenge.key) ?? []),
      ...(EXTRA_ANCHORS[challenge.key] ?? [])
    ]
    if (anchors.length === 0) {
      return { challenge, verdict: 'no-static-anchor', anchors: [], rules: [] }
    }
    const rules = new Set<string>()
    for (const a of anchors) {
      for (const r of rulesByFile.get(a) ?? []) rules.add(r)
    }
    return rules.size > 0
      ? {
          challenge,
          verdict: 'recalled',
          anchors,
          rules: [...rules].sort()
        }
      : { challenge, verdict: 'pending-human', anchors, rules: [] }
  })
  rows.sort((a, b) => a.challenge.key.localeCompare(b.challenge.key))

  const summary = {
    date: new Date().toISOString().slice(0, 10),
    challenges: rows.length,
    recalled: rows.filter((r) => r.verdict === 'recalled').length,
    pendingHuman: rows.filter((r) => r.verdict === 'pending-human').length,
    noStaticAnchor: rows.filter((r) => r.verdict === 'no-static-anchor').length,
    scannedFiles: result.report.files,
    diagnostics: diags.length
  }

  await mkdir(path.dirname(OUT_JSON), { recursive: true })
  await writeFile(
    OUT_JSON,
    `${JSON.stringify({ summary, rows }, null, 2)}\n`
  )

  console.log(`# juice-shop 逐挑战召回对照（${summary.date}）\n`)
  console.log(
    `总挑战 ${summary.challenges} · recalled ${summary.recalled} · pending-human ${summary.pendingHuman} · no-static-anchor ${summary.noStaticAnchor}`
  )
  console.log(`扫描 ${summary.scannedFiles} 文件 / 全量诊断 ${summary.diagnostics} 条\n`)
  console.log('| 挑战 key | 类别 | 判定 | 锚点 | 命中规则 |')
  console.log('| --- | --- | --- | --- | --- |')
  for (const r of rows) {
    const c = r.challenge
    const mark =
      r.verdict === 'recalled'
        ? '✅ recalled'
        : r.verdict === 'pending-human'
          ? '⚠️ pending-human'
          : '➖ no-anchor'
    // codefixes 变体折叠为「codefixes ×N」（明细看机器可读 JSON）
    const cfCount = r.anchors.filter((a) => a.includes('codefixes')).length
    const anchors = [
      ...(cfCount > 0 ? [`codefixes ×${cfCount}`] : []),
      ...r.anchors.filter((a) => !a.includes('codefixes'))
    ].join('<br>')
    const rules = r.rules.join(', ')
    console.log(`| ${c.key} | ${c.category} | ${mark} | ${anchors} | ${rules} |`)
  }
  console.log(`\n机器可读：${path.relative(ROOT, OUT_JSON)}`)
}

await main()
