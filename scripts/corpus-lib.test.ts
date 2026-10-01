/**
 * T1.18 语料库基线核心库单测（双报检测 / 指纹摘要 / 基线 diff）。
 * 端到端扫描门禁在 scripts/corpus-baseline.ts（需语料克隆，不进 bun test）。
 */
import { describe, expect, test } from 'bun:test'
import { buildDigest, detectDoubleReports, diffDigest } from './corpus-lib'
import type { LintsightDiagnostic } from '@lintsight/diagnostic'

function diag(
  ruleId: string,
  owner: 'lintsight-js' | 'oxlint-native',
  file = 'a.ts',
  offset = 0,
  length = 5
): LintsightDiagnostic {
  return {
    contractVersion: '1',
    ruleId,
    severity: 'error',
    message: 'm',
    file,
    span: { offset, length, line: 1, column: 1 },
    fingerprint: `${ruleId}-${file}-${offset}`,
    owner
  }
}

describe('corpus-lib: 双报检测', () => {
  test('同位置跨引擎双 owner → 双报事件', () => {
    const events = detectDoubleReports([
      diag('lintsight/no-empty-catch', 'lintsight-js', 'a.ts', 100, 11),
      diag('eslint/no-empty', 'oxlint-native', 'a.ts', 100, 11)
    ])
    expect(events).toHaveLength(1)
    expect(events[0].file).toBe('a.ts')
    expect(events[0].rules.map((r) => r.owner).sort()).toEqual([
      'lintsight-js',
      'oxlint-native'
    ])
  })

  test('同引擎多规则 / 不同位置 / 不同文件 → 不算双报', () => {
    const events = detectDoubleReports([
      diag('eslint/no-empty', 'oxlint-native', 'a.ts', 100, 11),
      diag('eslint/no-unused-vars', 'oxlint-native', 'a.ts', 100, 11), // 同位置同引擎
      diag('lintsight/no-empty-catch', 'lintsight-js', 'a.ts', 200, 11), // 同文件不同位置
      diag('lintsight/no-empty-catch', 'lintsight-js', 'b.ts', 100, 11) // 不同文件
    ])
    expect(events).toHaveLength(0)
  })

  test('双报事件按 file+offset 确定性排序', () => {
    const events = detectDoubleReports([
      diag('lintsight/no-empty-catch', 'lintsight-js', 'b.ts', 5, 1),
      diag('eslint/no-empty', 'oxlint-native', 'b.ts', 5, 1),
      diag('lintsight/no-empty-catch', 'lintsight-js', 'a.ts', 9, 1),
      diag('eslint/no-empty', 'oxlint-native', 'a.ts', 9, 1)
    ])
    expect(events.map((e) => e.file)).toEqual(['a.ts', 'b.ts'])
  })
})

describe('corpus-lib: 摘要与 diff', () => {
  test('buildDigest：byRule 计数排序 + 指纹哈希稳定', () => {
    const d1 = buildDigest([
      diag('r/b', 'oxlint-native'),
      diag('r/a', 'oxlint-native'),
      diag('r/a', 'oxlint-native', 'b.ts')
    ])
    expect(d1.total).toBe(3)
    expect(d1.byRule).toEqual({ 'r/a': 2, 'r/b': 1 })
    const d2 = buildDigest([
      diag('r/a', 'oxlint-native', 'b.ts'),
      diag('r/b', 'oxlint-native'),
      diag('r/a', 'oxlint-native')
    ])
    expect(d2.fingerprintsHash).toBe(d1.fingerprintsHash) // 顺序无关
  })

  test('diffDigest：一致 → unchanged；增删 → 指纹级与 ruleId 级差异', () => {
    const base = buildDigest([
      diag('r/a', 'oxlint-native'),
      diag('r/b', 'oxlint-native', 'b.ts', 10)
    ])
    expect(diffDigest(base, buildDigest([
      diag('r/a', 'oxlint-native'),
      diag('r/b', 'oxlint-native', 'b.ts', 10)
    ])).unchanged).toBe(true)

    const current = buildDigest([
      diag('r/a', 'oxlint-native'),
      diag('r/c', 'oxlint-native', 'c.ts', 20)
    ])
    const diff = diffDigest(base, current)
    expect(diff.unchanged).toBe(false)
    expect(diff.byRuleDelta).toEqual({ 'r/b': -1, 'r/c': 1 })
    expect(diff.newFingerprints).toEqual(['r/c-c.ts-20'])
    expect(diff.goneFingerprints).toEqual(['r/b-b.ts-10'])
  })
})
