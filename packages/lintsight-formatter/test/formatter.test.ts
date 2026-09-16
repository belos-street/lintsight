import { describe, expect, test } from 'bun:test'
import { formatJson, formatText } from '../src/index'

const report = {
  contractVersion: '1',
  files: 2,
  summary: { error: 1, warning: 1, info: 0 },
  diagnostics: [
    {
      file: 'a.ts',
      span: { line: 5, column: 3 },
      severity: 'error',
      ruleId: 'lintsight/no-empty-catch',
      message: 'Unexpected empty catch block.'
    },
    {
      file: 'b.ts',
      span: { line: 1, column: 1 },
      severity: 'warning',
      ruleId: 'eslint/no-unused-vars',
      message: "Variable 'x' is declared but never used."
    }
  ]
}

describe('formatter', () => {
  test('formatText：file:line:col  severity  ruleId  message + summary', () => {
    expect(formatText(report)).toBe(
      [
        'a.ts:5:3  error    lintsight/no-empty-catch  Unexpected empty catch block.',
        'b.ts:1:1  warning  eslint/no-unused-vars  Variable \'x\' is declared but never used.',
        '',
        'summary: 1 error(s), 1 warning(s), 0 info, 2 file(s)'
      ].join('\n')
    )
  })

  test('formatJson：可解析且字段保真', () => {
    const parsed = JSON.parse(formatJson(report))
    expect(parsed.contractVersion).toBe('1')
    expect(parsed.diagnostics).toHaveLength(2)
    expect(parsed.summary).toEqual({ error: 1, warning: 1, info: 0 })
  })

  test('空诊断：仅 summary 行', () => {
    expect(
      formatText({ contractVersion: '1', files: 1, summary: { error: 0, warning: 0, info: 0 }, diagnostics: [] })
    ).toBe('summary: 0 error(s), 0 warning(s), 0 info, 1 file(s)')
  })
})
