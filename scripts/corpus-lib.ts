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
