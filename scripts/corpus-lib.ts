/**
 * T1.18 语料库基线核心库（纯函数，供 corpus-baseline.ts 与单测复用）。
 *
 * 双报口径（M1，§3.6 双报消解的代理指标）：同一 (file, span.offset, span.length)
 * 同时被 lintsight-js 与 oxlint-native 两个引擎命中 → 双报事件，门禁 = 0。
 * 跨引擎同位置重合而语义不同的情形应趋近于零，出现即人工评审（白名单或修规则）。
 */
import type { LintsightDiagnostic } from '@lintsight/diagnostic'

export interface DoubleReportEvent {
  file: string
  offset: number
  length: number
  rules: { ruleId: string; owner: string }[]
}

export interface CorpusDigest {
  total: number
  byRule: Record<string, number>
  /** sha256(排序后指纹拼接)——整体一致性快检 */
  fingerprintsHash: string
  /** 排序后全量指纹（基线入库，diff 的最小单元） */
  fingerprints: string[]
}

export function detectDoubleReports(
  diagnostics: LintsightDiagnostic[]
): DoubleReportEvent[] {
  const groups = new Map<
    string,
    { file: string; offset: number; length: number; rules: { ruleId: string; owner: string }[] }
  >()
  for (const d of diagnostics) {
    const key = `${d.file}|${d.span.offset}|${d.span.length}`
    let g = groups.get(key)
    if (!g) {
      g = { file: d.file, offset: d.span.offset, length: d.span.length, rules: [] }
      groups.set(key, g)
    }
    g.rules.push({ ruleId: d.ruleId, owner: d.owner })
  }

  const events: DoubleReportEvent[] = []
  for (const g of groups.values()) {
    const owners = new Set(g.rules.map((r) => r.owner))
    if (owners.has('lintsight-js') && owners.has('oxlint-native')) {
      events.push({
        file: g.file,
        offset: g.offset,
        length: g.length,
        rules: g.rules.sort((a, b) => a.ruleId.localeCompare(b.ruleId))
      })
    }
  }
  return events.sort(
    (a, b) => a.file.localeCompare(b.file) || a.offset - b.offset
  )
}

export function buildDigest(diagnostics: LintsightDiagnostic[]): CorpusDigest {
  const byRule: Record<string, number> = {}
  const fingerprints: string[] = []
  for (const d of diagnostics) {
    byRule[d.ruleId] = (byRule[d.ruleId] ?? 0) + 1
    fingerprints.push(d.fingerprint)
  }
  fingerprints.sort()
  const fingerprintsHash = new Bun.CryptoHasher('sha256')
    .update(fingerprints.join('\n'))
    .digest('hex')
  const sortedByRule: Record<string, number> = {}
  for (const k of Object.keys(byRule).sort()) sortedByRule[k] = byRule[k]
  return { total: diagnostics.length, byRule: sortedByRule, fingerprintsHash, fingerprints }
}

export interface DigestDiff {
  /** 整体一致（fingerprintsHash 相同）→ 无漂移 */
  unchanged: boolean
  /** 按 ruleId 聚合的数量差（current - baseline），仅列非零项 */
  byRuleDelta: Record<string, number>
  newFingerprints: string[]
  goneFingerprints: string[]
}

export function diffDigest(
  baseline: CorpusDigest,
  current: CorpusDigest
): DigestDiff {
  if (baseline.fingerprintsHash === current.fingerprintsHash) {
    return { unchanged: true, byRuleDelta: {}, newFingerprints: [], goneFingerprints: [] }
  }

  const ruleIds = new Set([
    ...Object.keys(baseline.byRule),
    ...Object.keys(current.byRule)
  ])
  const byRuleDelta: Record<string, number> = {}
  for (const k of ruleIds) {
    const delta = (current.byRule[k] ?? 0) - (baseline.byRule[k] ?? 0)
    if (delta !== 0) byRuleDelta[k] = delta
  }

  const baseSet = new Set(baseline.fingerprints)
  const curSet = new Set(current.fingerprints)
  const newFingerprints = current.fingerprints.filter((f) => !baseSet.has(f))
  const goneFingerprints = baseline.fingerprints.filter((f) => !curSet.has(f))

  return { unchanged: false, byRuleDelta, newFingerprints, goneFingerprints }
}

// —— juice-shop 召回制度化（FR-303 验收配套，2026-10-05 转正） ——

export interface JuiceChallenge {
  key: string
  name: string
  category: string
}

/** challenges.yml 解析（juice-shop data/static/challenges.yml 实测格式）：
 * 块分隔 = 行首独立 `-`；字段两空格缩进；hints/tags/disabledEnv 等嵌套列表行
 * 不匹配 `  字段: 值` 形态自然跳过。只提取 key/name/category（召回对照所需）。
 * 值的引号剥离取成对引号内内容（csrfChallenge 的 name 带 YAML 注释尾巴，实测）。 */
export function parseChallengesYml(text: string): JuiceChallenge[] {
  const out: JuiceChallenge[] = []
  let cur: Partial<JuiceChallenge> | null = null
  for (const line of text.split('\n')) {
    if (line.trimEnd() === '-') {
      if (cur?.key)
        out.push({
          key: cur.key,
          name: cur.name ?? '',
          category: cur.category ?? ''
        })
      cur = null
      continue
    }
    if (!cur) cur = {}
    const m = line.match(/^  (\w+): (.*)$/)
    if (!m) continue
    const quoted = m[2].match(/^(['"])(.*?)\1/)
    const val = quoted ? quoted[2] : m[2]
    if (m[1] === 'key') cur.key = val
    else if (m[1] === 'name') cur.name = val
    else if (m[1] === 'category') cur.category = val
  }
  if (cur?.key)
    out.push({
      key: cur.key,
      name: cur.name ?? '',
      category: cur.category ?? ''
    })
  return out
}

/** codefixes 文件名 → 挑战 key 映射：文件名（basename）内嵌挑战 key
 * （`<key>_<n>.ts` / `<key>_<n>_correct.ts`——官方修复挑战片段语料）。
 * 返回 key → 文件相对路径列表（保持输入序）。 */
export function mapCodefixes(files: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const f of files) {
    const base = f
      .split('/')
      .pop()!
      .replace(/\.ts$/, '')
      .replace(/_correct$/, '')
      .replace(/_\d+$/, '')
    if (!base) continue
    const list = map.get(base) ?? []
    list.push(f)
    map.set(base, list)
  }
  return map
}
