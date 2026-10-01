/**
 * T1.2 diagnostic 防御归一化清单单测（全部来自竖切实证，spike 报告 §关键实证）。
 */
import { describe, expect, test } from 'bun:test'
import {
  CONTRACT_VERSION,
  computeFingerprint,
  normalizeDiagnostics,
  normalizeFilePath,
  normalizeRuleId,
  sortDiagnostics,
  suppressSuperseded,
  toLintsightDiagnostic,
  TYPE_AWARE_ERROR_RULE_ID,
  type LintsightDiagnostic,
  type NormalizedDiagnostic
} from '../src/index'

const ROOT = '/Users/dev/repo'

describe('normalizeRuleId', () => {
  test('plugin(rule) → plugin/rule', () => {
    expect(normalizeRuleId('eslint(no-debugger)')).toBe('eslint/no-debugger')
    expect(normalizeRuleId('lintsight(no-empty-catch)')).toBe(
      'lintsight/no-empty-catch'
    )
  })
  test('已含 / 或非标准格式原样返回', () => {
    expect(normalizeRuleId('lintsight/no-empty-catch')).toBe(
      'lintsight/no-empty-catch'
    )
    expect(normalizeRuleId('weird')).toBe('weird')
  })
})

describe('normalizeFilePath（双候选兜底）', () => {
  test('相对路径 → 相对项目根', () => {
    expect(normalizeFilePath('fixtures/a.ts', ROOT)).toBe('fixtures/a.ts')
  })
  test('绝对路径 → 相对项目根', () => {
    expect(normalizeFilePath('/Users/dev/repo/fixtures/a.ts', ROOT)).toBe(
      'fixtures/a.ts'
    )
  })
  test('oxlint 剥掉开头 / 的绝对路径（实测怪癖）', () => {
    expect(normalizeFilePath('Users/dev/repo/fixtures/a.ts', ROOT)).toBe(
      'fixtures/a.ts'
    )
  })
  test('项目根带尾斜杠不影响判断', () => {
    expect(normalizeFilePath('fixtures/a.ts', '/Users/dev/repo/')).toBe(
      'fixtures/a.ts'
    )
    expect(
      normalizeFilePath('/Users/dev/repo/fixtures/a.ts', '/Users/dev/repo/')
    ).toBe('fixtures/a.ts')
  })
  test('项目外路径原样返回', () => {
    expect(normalizeFilePath('/somewhere/else/a.ts', ROOT)).toBe(
      '/somewhere/else/a.ts'
    )
    expect(normalizeFilePath('elsewhere/a.ts', ROOT)).toBe('elsewhere/a.ts')
  })
})

describe('fingerprint（M1-DR2）', () => {
  const base: NormalizedDiagnostic = {
    ruleId: 'lintsight/no-empty-catch',
    severity: 'error',
    message: 'Unexpected empty catch block.',
    file: 'fixtures/a.ts',
    span: { offset: 10, length: 7, line: 3, column: 5 }
  }
  test('同输入同指纹，64 位 hex', () => {
    expect(computeFingerprint(base)).toBe(computeFingerprint(base))
    expect(computeFingerprint(base)).toMatch(/^[0-9a-f]{64}$/)
  })
  test('message 文本变化 → 指纹漂移（文案变更为 breaking 的依据）', () => {
    expect(
      computeFingerprint({ ...base, message: 'Different copy.' })
    ).not.toBe(computeFingerprint(base))
  })
  test('span 变化 → 指纹漂移', () => {
    expect(
      computeFingerprint({ ...base, span: { ...base.span, line: 4 } })
    ).not.toBe(computeFingerprint(base))
  })
})

describe('owner 推导与统一模型', () => {
  test('lintsight/ 前缀 → lintsight-js，其余 → oxlint-native', () => {
    const d = toLintsightDiagnostic({
      ruleId: 'lintsight/no-empty-catch',
      severity: 'error',
      message: 'm',
      file: 'a.ts',
      span: { offset: 0, length: 1, line: 1, column: 1 }
    })
    expect(d.owner).toBe('lintsight-js')
    expect(d.contractVersion).toBe(CONTRACT_VERSION)
    expect(CONTRACT_VERSION).toBe('1')
    expect(
      toLintsightDiagnostic({
        ruleId: 'eslint/no-debugger',
        severity: 'warning',
        message: 'm',
        file: 'a.ts',
        span: { offset: 0, length: 1, line: 1, column: 1 }
      }).owner
    ).toBe('oxlint-native')
  })
})

describe('确定性排序（M1-DR4）', () => {
  test('乱序输入 → (file, offset, ruleId) 稳定有序', () => {
    const mk = (file: string, offset: number, ruleId: string) =>
      toLintsightDiagnostic({
        ruleId,
        severity: 'warning',
        message: 'm',
        file,
        span: { offset, length: 1, line: 1, column: 1 }
      })
    const input = [
      mk('b.ts', 1, 'z/rule'),
      mk('a.ts', 9, 'a/rule'),
      mk('a.ts', 2, 'z/rule'),
      mk('a.ts', 2, 'a/rule')
    ]
    const out = sortDiagnostics([...input])
    expect(out.map((d) => `${d.file}:${d.span.offset}:${d.ruleId}`)).toEqual([
      'a.ts:2:a/rule',
      'a.ts:2:z/rule',
      'a.ts:9:a/rule',
      'b.ts:1:z/rule'
    ])
  })
})

describe('normalizeDiagnostics', () => {
  test('oxlint JSON → 归一化 DTO，无 labels 时 span 兜底零值', () => {
    const out = normalizeDiagnostics(
      {
        diagnostics: [
          {
            message: 'm',
            code: 'eslint(x)',
            severity: 'warning',
            filename: 'Users/dev/repo/a.ts',
            labels: []
          }
        ],
        number_of_files: 1,
        number_of_rules: 9
      },
      ROOT
    )
    expect(out[0]).toEqual({
      ruleId: 'eslint/x',
      severity: 'warning',
      message: 'm',
      file: 'a.ts',
      span: { offset: 0, length: 0, line: 0, column: 0 }
    })
  })

  test('type-aware 编排（spike ③）：typescript(tsconfig-error) 降级为 info', () => {
    const out = normalizeDiagnostics(
      {
        diagnostics: [
          {
            message: "Option 'baseUrl' is deprecated.",
            code: 'typescript(tsconfig-error)',
            severity: 'error',
            filename: 'a.ts',
            labels: [{ span: { offset: 0, length: 4, line: 1, column: 1 } }]
          }
        ],
        number_of_files: 1,
        number_of_rules: 1
      },
      ROOT
    )
    expect(out[0].ruleId).toBe(TYPE_AWARE_ERROR_RULE_ID)
    expect(out[0].severity).toBe('info')
  })
})

describe('suppressSuperseded（M2 T2.5 双报消解，design-m2 §4.4）', () => {
  const diag = (
    ruleId: string,
    file: string,
    line: number,
    offset: number
  ): LintsightDiagnostic => ({
    contractVersion: CONTRACT_VERSION,
    ruleId,
    severity: 'error',
    message: 'm',
    file,
    span: { offset, length: 10, line, column: 1 },
    fingerprint: 'f'.repeat(64),
    owner: ruleId.startsWith('lintsight-engine/')
      ? 'lintsight-engine'
      : ruleId.startsWith('lintsight/')
        ? 'lintsight-js'
        : 'oxlint-native'
  })

  test('engine 命中行 → 同文件同行 JS 版抑制；他行/他文件保留', () => {
    const input = [
      diag('lintsight/no-non-literal-fs-filename', 'a.ts', 159, 4700), // 同行 → 抑制
      diag('lintsight/no-non-literal-fs-filename', 'a.ts', 155, 4400), // 他行 → 保留
      diag('lintsight/no-non-literal-fs-filename', 'b.ts', 159, 4700), // 他文件 → 保留
      diag('lintsight-engine/no-path-traversal', 'a.ts', 159, 4791), // engine 恒保留
      diag('eslint/no-var', 'a.ts', 159, 100) // 非 lintsight-js → 不受消解影响
    ]
    const out = suppressSuperseded(input)
    // 纯过滤保序：a.ts:159 的 JS 版被抑制，其余原序保留
    expect(out.map((d) => `${d.ruleId}@${d.file}:${d.span.line}`)).toEqual([
      'lintsight/no-non-literal-fs-filename@a.ts:155',
      'lintsight/no-non-literal-fs-filename@b.ts:159',
      'lintsight-engine/no-path-traversal@a.ts:159',
      'eslint/no-var@a.ts:159'
    ])
  })

  test('无 engine 命中 → 原样返回（零开销路径）', () => {
    const input = [diag('lintsight/no-non-literal-fs-filename', 'a.ts', 1, 0)]
    expect(suppressSuperseded(input)).toEqual(input)
  })
})
