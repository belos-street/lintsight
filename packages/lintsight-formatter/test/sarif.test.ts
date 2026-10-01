/**
 * T2.5 SARIF 2.1.0 报告器测试：schema 结构锁定（平台对接契约）。
 * level 映射 error→error / warning→warning / info→note；rules 数组去重排序。
 */
import { describe, expect, test } from 'bun:test'
import { formatSarif } from '../src/sarif'

const report = {
  contractVersion: '1',
  files: 2,
  summary: { error: 1, warning: 1, info: 1 },
  diagnostics: [
    {
      contractVersion: '1',
      ruleId: 'lintsight-engine/no-path-traversal',
      severity: 'error',
      message:
        'Untrusted filename from fs.readdirSync reaches fs.readFileSync.',
      file: 'src/lib/db.ts',
      span: { offset: 4791, length: 34, line: 159, column: 33 },
      fingerprint: 'f'.repeat(64),
      owner: 'lintsight-engine' as const
    },
    {
      contractVersion: '1',
      ruleId: 'lintsight/no-sync-io-in-async',
      severity: 'warning',
      message: 'sync io in async',
      file: 'src/a.ts',
      span: { offset: 10, length: 5, line: 3, column: 3 },
      fingerprint: 'e'.repeat(64),
      owner: 'lintsight-js' as const
    },
    {
      contractVersion: '1',
      ruleId: 'typescript/tsconfig-error',
      severity: 'info',
      message: "Option 'baseUrl' is deprecated.",
      file: 'src/a.ts',
      span: { offset: 0, length: 4, line: 1, column: 1 },
      fingerprint: 'd'.repeat(64),
      owner: 'oxlint-native' as const
    }
  ]
}

describe('formatSarif（SARIF 2.1.0）', () => {
  const sarif = JSON.parse(formatSarif(report))

  test('顶层结构：$schema / version / runs[0].tool.driver', () => {
    expect(sarif.$schema).toBe('https://json.schemastore.org/sarif-2.1.0.json')
    expect(sarif.version).toBe('2.1.0')
    expect(sarif.runs).toHaveLength(1)
    expect(sarif.runs[0].tool.driver.name).toBe('lintsight')
    // rules 去重且确定性排序（含跨 owner 规则）
    expect(
      sarif.runs[0].tool.driver.rules.map((r: { id: string }) => r.id)
    ).toEqual([
      'lintsight-engine/no-path-traversal',
      'lintsight/no-sync-io-in-async',
      'typescript/tsconfig-error'
    ])
  })

  test('results：ruleIndex / level 映射 / 物理位置', () => {
    const results = sarif.runs[0].results
    expect(results).toHaveLength(3)
    expect(results[0].ruleId).toBe('lintsight-engine/no-path-traversal')
    expect(results[0].ruleIndex).toBe(0)
    expect(results[0].level).toBe('error')
    expect(results[0].message.text).toContain('readdirSync')
    expect(results[0].locations[0].physicalLocation).toEqual({
      artifactLocation: { uri: 'src/lib/db.ts' },
      region: { startLine: 159, startColumn: 33 }
    })
    expect(results[1].level).toBe('warning')
    // type-aware 降级诊断 → SARIF note
    expect(results[2].ruleId).toBe('typescript/tsconfig-error')
    expect(results[2].level).toBe('note')
  })
})
