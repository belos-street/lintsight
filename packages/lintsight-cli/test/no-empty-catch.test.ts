/**
 * RuleTester（用例即契约，rule-authoring skill）：bun test 承载。
 * no-empty-catch：3 invalid + 2 valid，覆盖边界矩阵（可选 binding / 嵌套 / TS 断言共存 / 注释字符串干扰）。
 * 断言只看 lintsight/* 诊断——内置规则的噪音不进本契约。
 * 注：本测试走 oxlint 自动发现根 .oxlintrc.json（dev 配置含 jsPlugins）。
 */
import { describe, expect, test } from 'bun:test'
import { runOxlint } from '../src/oxlint-bridge'
import { normalizeDiagnostics } from '@lintsight/diagnostic'

const PROJECT_ROOT = new URL('../../../', import.meta.url).pathname

interface TestCase {
  file: string
  /** 期望的 lintsight/no-empty-catch 诊断位置（1-based） */
  expected: { line: number; column: number }[]
}

const cases: TestCase[] = [
  {
    file: 'fixtures/ts/no-empty-catch.bad-1.ts',
    expected: [{ line: 5, column: 5 }]
  },
  {
    file: 'fixtures/ts/no-empty-catch.bad-2.ts',
    expected: [{ line: 5, column: 5 }]
  },
  {
    file: 'fixtures/ts/no-empty-catch.bad-3.ts',
    expected: [
      { line: 8, column: 7 }, // 内层 catch
      { line: 10, column: 5 } // 外层 catch
    ]
  },
  { file: 'fixtures/ts/no-empty-catch.good-1.ts', expected: [] },
  { file: 'fixtures/ts/no-empty-catch.good-2.ts', expected: [] }
]

const byFile = new Map<
  string,
  { ruleId: string; severity: string; span: { line: number; column: number } }[]
>()

// 一次 spawn 扫全部 fixture，按文件分组
const scan = await runOxlint(
  cases.map((c) => `${PROJECT_ROOT}${c.file}`),
  { cwd: PROJECT_ROOT }
)
for (const d of normalizeDiagnostics(scan.output!, PROJECT_ROOT)) {
  const list = byFile.get(d.file) ?? []
  list.push(d)
  byFile.set(d.file, list)
}

const lint = (file: string) =>
  (byFile.get(file) ?? []).filter(
    (d) => d.ruleId === 'lintsight/no-empty-catch'
  )

describe('lintsight/no-empty-catch (oxlint JS Plugin · alpha)', () => {
  for (const c of cases) {
    test(c.file, () => {
      const diags = lint(c.file)
      expect(diags).toHaveLength(c.expected.length)
      for (const [i, pos] of c.expected.entries()) {
        expect(diags[i].span.line).toBe(pos.line)
        expect(diags[i].span.column).toBe(pos.column)
      }
      for (const d of diags) {
        expect(d.severity).toBe('error')
        expect(d.ruleId).toMatch(/^lintsight\//) // 规则命名空间契约
      }
    })
  }

  test('scan exit code 语义：有 error 级诊断时 oxlint exit=1', () => {
    expect(scan.exitCode).toBe(1)
  })
})
