/**
 * P0 安全语法级规则契约（v0.1① 定稿清单，S4）：每条 ≥3 bad / ≥2 good，CWE/OWASP 映射见清单。
 * 期望位置来自实现前 fixture 设计 + 探测校准（用例先行）。
 * 断言只看目标 ruleId 诊断，内置噪音与跨规则交叉不进契约。
 */
import { describe, test } from 'bun:test'
import { defineRuleTester } from '@lintsight/rule-sdk/testing'

const ROOT = new URL('../../../', import.meta.url).pathname

interface Case {
  file: string
  expect: { line: number; column: number }[]
}

async function runCases(ruleId: string, cases: Case[]) {
  const tester = defineRuleTester({ ruleId })
  const results = await tester.run(cases, { cwd: ROOT })
  return { tester, results }
}

describe('P0 安全规则契约', () => {
  test('no-hardcoded-credentials (CWE-798)', async () => {
    const cases: Case[] = [
      {
        file: 'fixtures/ts/no-hardcoded-credentials.bad-1.ts',
        expect: [{ line: 3, column: 3 }]
      },
      {
        file: 'fixtures/ts/no-hardcoded-credentials.bad-2.ts',
        expect: [{ line: 2, column: 14 }]
      },
      {
        file: 'fixtures/ts/no-hardcoded-credentials.bad-3.ts',
        expect: [{ line: 3, column: 3 }]
      },
      { file: 'fixtures/ts/no-hardcoded-credentials.good-1.ts', expect: [] },
      { file: 'fixtures/ts/no-hardcoded-credentials.good-2.ts', expect: [] }
    ]
    const { tester, results } = await runCases(
      'lintsight/no-hardcoded-credentials',
      cases
    )
    for (const c of cases) tester.expect(results, c)
  })

  test('no-unsafe-regex (CWE-1333)', async () => {
    const cases: Case[] = [
      {
        file: 'fixtures/ts/no-unsafe-regex.bad-1.ts',
        expect: [{ line: 3, column: 10 }]
      },
      {
        file: 'fixtures/ts/no-unsafe-regex.bad-2.ts',
        expect: [{ line: 3, column: 10 }]
      },
      {
        file: 'fixtures/ts/no-unsafe-regex.bad-3.ts',
        expect: [{ line: 3, column: 10 }]
      },
      { file: 'fixtures/ts/no-unsafe-regex.good-1.ts', expect: [] },
      { file: 'fixtures/ts/no-unsafe-regex.good-2.ts', expect: [] }
    ]
    const { tester, results } = await runCases(
      'lintsight/no-unsafe-regex',
      cases
    )
    for (const c of cases) tester.expect(results, c)
  })

  test('no-prototype-pollution-syntax (CWE-1321)', async () => {
    const cases: Case[] = [
      {
        file: 'fixtures/ts/no-prototype-pollution-syntax.bad-1.ts',
        expect: [{ line: 3, column: 3 }]
      },
      {
        file: 'fixtures/ts/no-prototype-pollution-syntax.bad-2.ts',
        expect: [{ line: 3, column: 3 }]
      },
      {
        file: 'fixtures/ts/no-prototype-pollution-syntax.bad-3.ts',
        expect: [{ line: 3, column: 12 }]
      },
      {
        file: 'fixtures/ts/no-prototype-pollution-syntax.good-1.ts',
        expect: []
      },
      {
        file: 'fixtures/ts/no-prototype-pollution-syntax.good-2.ts',
        expect: []
      }
    ]
    const { tester, results } = await runCases(
      'lintsight/no-prototype-pollution-syntax',
      cases
    )
    for (const c of cases) tester.expect(results, c)
  })

  test('no-child-process-nonliteral (CWE-78)', async () => {
    const cases: Case[] = [
      {
        file: 'fixtures/ts/no-child-process-nonliteral.bad-1.ts',
        expect: [{ line: 5, column: 10 }]
      },
      {
        file: 'fixtures/ts/no-child-process-nonliteral.bad-2.ts',
        expect: [{ line: 5, column: 10 }]
      },
      {
        file: 'fixtures/ts/no-child-process-nonliteral.bad-3.ts',
        expect: [{ line: 3, column: 10 }]
      },
      { file: 'fixtures/ts/no-child-process-nonliteral.good-1.ts', expect: [] },
      { file: 'fixtures/ts/no-child-process-nonliteral.good-2.ts', expect: [] }
    ]
    const { tester, results } = await runCases(
      'lintsight/no-child-process-nonliteral',
      cases
    )
    for (const c of cases) tester.expect(results, c)
  })

  test('no-non-literal-fs-filename (CWE-22, low 禁门禁)', async () => {
    const cases: Case[] = [
      {
        file: 'fixtures/ts/no-non-literal-fs-filename.bad-1.ts',
        expect: [{ line: 5, column: 3 }]
      },
      {
        file: 'fixtures/ts/no-non-literal-fs-filename.bad-2.ts',
        expect: [{ line: 5, column: 10 }]
      },
      {
        file: 'fixtures/ts/no-non-literal-fs-filename.bad-3.ts',
        expect: [{ line: 5, column: 3 }]
      },
      { file: 'fixtures/ts/no-non-literal-fs-filename.good-1.ts', expect: [] },
      { file: 'fixtures/ts/no-non-literal-fs-filename.good-2.ts', expect: [] }
    ]
    const { tester, results } = await runCases(
      'lintsight/no-non-literal-fs-filename',
      cases
    )
    for (const c of cases) tester.expect(results, c)
  })

  test('no-non-literal-require (CWE-94)', async () => {
    const cases: Case[] = [
      {
        file: 'fixtures/ts/no-non-literal-require.bad-1.ts',
        expect: [{ line: 3, column: 15 }]
      },
      {
        file: 'fixtures/ts/no-non-literal-require.bad-2.ts',
        expect: [{ line: 3, column: 18 }]
      },
      {
        file: 'fixtures/ts/no-non-literal-require.bad-3.ts',
        expect: [{ line: 3, column: 19 }]
      },
      { file: 'fixtures/ts/no-non-literal-require.good-1.ts', expect: [] },
      { file: 'fixtures/ts/no-non-literal-require.good-2.ts', expect: [] }
    ]
    const { tester, results } = await runCases(
      'lintsight/no-non-literal-require',
      cases
    )
    for (const c of cases) tester.expect(results, c)
  })

  test('no-weak-hash (CWE-327)', async () => {
    const cases: Case[] = [
      {
        file: 'fixtures/ts/no-weak-hash.bad-1.ts',
        expect: [{ line: 5, column: 10 }]
      },
      {
        file: 'fixtures/ts/no-weak-hash.bad-2.ts',
        expect: [{ line: 5, column: 10 }]
      },
      {
        file: 'fixtures/ts/no-weak-hash.bad-3.ts',
        expect: [{ line: 5, column: 10 }]
      },
      { file: 'fixtures/ts/no-weak-hash.good-1.ts', expect: [] },
      { file: 'fixtures/ts/no-weak-hash.good-2.ts', expect: [] }
    ]
    const { tester, results } = await runCases('lintsight/no-weak-hash', cases)
    for (const c of cases) tester.expect(results, c)
  })

  test('no-math-random-secret (CWE-338)', async () => {
    const cases: Case[] = [
      {
        file: 'fixtures/ts/no-math-random-secret.bad-1.ts',
        expect: [{ line: 3, column: 9 }]
      },
      {
        file: 'fixtures/ts/no-math-random-secret.bad-2.ts',
        expect: [{ line: 3, column: 9 }]
      },
      {
        file: 'fixtures/ts/no-math-random-secret.bad-3.ts',
        expect: [{ line: 3, column: 3 }]
      },
      { file: 'fixtures/ts/no-math-random-secret.good-1.ts', expect: [] },
      { file: 'fixtures/ts/no-math-random-secret.good-2.ts', expect: [] }
    ]
    const { tester, results } = await runCases(
      'lintsight/no-math-random-secret',
      cases
    )
    for (const c of cases) tester.expect(results, c)
  })

  test('no-sensitive-storage (CWE-312)', async () => {
    const cases: Case[] = [
      {
        file: 'fixtures/ts/no-sensitive-storage.bad-1.ts',
        expect: [{ line: 3, column: 3 }]
      },
      {
        file: 'fixtures/ts/no-sensitive-storage.bad-2.ts',
        expect: [{ line: 3, column: 3 }]
      },
      {
        file: 'fixtures/ts/no-sensitive-storage.bad-3.ts',
        expect: [{ line: 5, column: 3 }]
      },
      { file: 'fixtures/ts/no-sensitive-storage.good-1.ts', expect: [] },
      { file: 'fixtures/ts/no-sensitive-storage.good-2.ts', expect: [] }
    ]
    const { tester, results } = await runCases(
      'lintsight/no-sensitive-storage',
      cases
    )
    for (const c of cases) tester.expect(results, c)
  })

  test('no-innerhtml-assignment (CWE-79)', async () => {
    const cases: Case[] = [
      {
        file: 'fixtures/ts/no-innerhtml-assignment.bad-1.ts',
        expect: [{ line: 3, column: 3 }]
      },
      {
        file: 'fixtures/ts/no-innerhtml-assignment.bad-2.ts',
        expect: [{ line: 3, column: 3 }]
      },
      {
        file: 'fixtures/ts/no-innerhtml-assignment.bad-3.ts',
        expect: [{ line: 3, column: 3 }]
      },
      { file: 'fixtures/ts/no-innerhtml-assignment.good-1.ts', expect: [] },
      { file: 'fixtures/ts/no-innerhtml-assignment.good-2.ts', expect: [] }
    ]
    const { tester, results } = await runCases(
      'lintsight/no-innerhtml-assignment',
      cases
    )
    for (const c of cases) tester.expect(results, c)
  })

  test('no-sql-concat (CWE-89)', async () => {
    const cases: Case[] = [
      {
        file: 'fixtures/ts/no-sql-concat.bad-1.ts',
        expect: [{ line: 3, column: 13 }]
      },
      {
        file: 'fixtures/ts/no-sql-concat.bad-2.ts',
        expect: [{ line: 3, column: 13 }]
      },
      {
        file: 'fixtures/ts/no-sql-concat.bad-3.ts',
        expect: [{ line: 3, column: 13 }]
      },
      { file: 'fixtures/ts/no-sql-concat.good-1.ts', expect: [] },
      { file: 'fixtures/ts/no-sql-concat.good-2.ts', expect: [] }
    ]
    const { tester, results } = await runCases('lintsight/no-sql-concat', cases)
    for (const c of cases) tester.expect(results, c)
  })

  test('no-cors-wildcard (CWE-942)', async () => {
    const cases: Case[] = [
      {
        file: 'fixtures/ts/no-cors-wildcard.bad-1.ts',
        expect: [{ line: 3, column: 3 }]
      },
      {
        file: 'fixtures/ts/no-cors-wildcard.bad-2.ts',
        expect: [{ line: 4, column: 5 }]
      },
      {
        file: 'fixtures/ts/no-cors-wildcard.bad-3.ts',
        expect: [{ line: 5, column: 10 }]
      },
      { file: 'fixtures/ts/no-cors-wildcard.good-1.ts', expect: [] },
      { file: 'fixtures/ts/no-cors-wildcard.good-2.ts', expect: [] }
    ]
    const { tester, results } = await runCases(
      'lintsight/no-cors-wildcard',
      cases
    )
    for (const c of cases) tester.expect(results, c)
  })

  test('no-vm-dynamic-code (CWE-94)', async () => {
    const cases: Case[] = [
      {
        file: 'fixtures/ts/no-vm-dynamic-code.bad-1.ts',
        expect: [{ line: 5, column: 10 }]
      },
      {
        file: 'fixtures/ts/no-vm-dynamic-code.bad-2.ts',
        expect: [{ line: 3, column: 10 }]
      },
      {
        file: 'fixtures/ts/no-vm-dynamic-code.bad-3.ts',
        expect: [{ line: 5, column: 10 }]
      },
      { file: 'fixtures/ts/no-vm-dynamic-code.good-1.ts', expect: [] },
      { file: 'fixtures/ts/no-vm-dynamic-code.good-2.ts', expect: [] }
    ]
    const { tester, results } = await runCases(
      'lintsight/no-vm-dynamic-code',
      cases
    )
    for (const c of cases) tester.expect(results, c)
  })

  test('no-insecure-cookie (CWE-614/1004)', async () => {
    const cases: Case[] = [
      {
        file: 'fixtures/ts/no-insecure-cookie.bad-1.ts',
        expect: [{ line: 3, column: 3 }]
      },
      {
        file: 'fixtures/ts/no-insecure-cookie.bad-2.ts',
        expect: [{ line: 3, column: 3 }]
      },
      {
        file: 'fixtures/ts/no-insecure-cookie.bad-3.ts',
        expect: [{ line: 3, column: 3 }]
      },
      { file: 'fixtures/ts/no-insecure-cookie.good-1.ts', expect: [] },
      { file: 'fixtures/ts/no-insecure-cookie.good-2.ts', expect: [] }
    ]
    const { tester, results } = await runCases(
      'lintsight/no-insecure-cookie',
      cases
    )
    for (const c of cases) tester.expect(results, c)
  })
})
