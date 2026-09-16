/**
 * P0 正确性规则契约（v0.1① 定稿清单，S3）：每条 ≥3 bad / ≥2 good。
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

describe('P0 正确性规则契约', () => {
  test('no-floating-promise', async () => {
    const cases: Case[] = [
      {
        file: 'fixtures/ts/no-floating-promise.bad-1.ts',
        expect: [{ line: 3, column: 3 }]
      },
      {
        file: 'fixtures/ts/no-floating-promise.bad-2.ts',
        expect: [{ line: 3, column: 3 }]
      },
      {
        file: 'fixtures/ts/no-floating-promise.bad-3.ts',
        expect: [{ line: 3, column: 3 }]
      },
      { file: 'fixtures/ts/no-floating-promise.good-1.ts', expect: [] },
      { file: 'fixtures/ts/no-floating-promise.good-2.ts', expect: [] }
    ]
    const { tester, results } = await runCases(
      'lintsight/no-floating-promise',
      cases
    )
    for (const c of cases) tester.expect(results, c)
  })

  test('no-swallowed-promise-error', async () => {
    const cases: Case[] = [
      {
        file: 'fixtures/ts/no-swallowed-promise-error.bad-1.ts',
        expect: [{ line: 5, column: 5 }]
      },
      {
        file: 'fixtures/ts/no-swallowed-promise-error.bad-2.ts',
        expect: [{ line: 5, column: 5 }]
      },
      {
        file: 'fixtures/ts/no-swallowed-promise-error.bad-3.ts',
        expect: [{ line: 5, column: 5 }]
      },
      { file: 'fixtures/ts/no-swallowed-promise-error.good-1.ts', expect: [] },
      { file: 'fixtures/ts/no-swallowed-promise-error.good-2.ts', expect: [] }
    ]
    const { tester, results } = await runCases(
      'lintsight/no-swallowed-promise-error',
      cases
    )
    for (const c of cases) tester.expect(results, c)
  })

  test('no-closure-loop-var', async () => {
    const cases: Case[] = [
      {
        file: 'fixtures/ts/no-closure-loop-var.bad-1.ts',
        expect: [{ line: 3, column: 3 }]
      },
      {
        file: 'fixtures/ts/no-closure-loop-var.bad-2.ts',
        expect: [{ line: 3, column: 3 }]
      },
      {
        file: 'fixtures/ts/no-closure-loop-var.bad-3.ts',
        expect: [{ line: 3, column: 3 }]
      },
      { file: 'fixtures/ts/no-closure-loop-var.good-1.ts', expect: [] },
      { file: 'fixtures/ts/no-closure-loop-var.good-2.ts', expect: [] }
    ]
    const { tester, results } = await runCases(
      'lintsight/no-closure-loop-var',
      cases
    )
    for (const c of cases) tester.expect(results, c)
  })

  test('no-array-map-side-effect', async () => {
    const cases: Case[] = [
      {
        file: 'fixtures/ts/no-array-map-side-effect.bad-1.ts',
        expect: [{ line: 3, column: 3 }]
      },
      {
        file: 'fixtures/ts/no-array-map-side-effect.bad-2.ts',
        expect: [{ line: 3, column: 3 }]
      },
      {
        file: 'fixtures/ts/no-array-map-side-effect.bad-3.ts',
        expect: [{ line: 3, column: 3 }]
      },
      { file: 'fixtures/ts/no-array-map-side-effect.good-1.ts', expect: [] },
      { file: 'fixtures/ts/no-array-map-side-effect.good-2.ts', expect: [] }
    ]
    const { tester, results } = await runCases(
      'lintsight/no-array-map-side-effect',
      cases
    )
    for (const c of cases) tester.expect(results, c)
  })

  test('no-json-structured-clone', async () => {
    const cases: Case[] = [
      {
        file: 'fixtures/ts/no-json-structured-clone.bad-1.ts',
        expect: [{ line: 3, column: 10 }]
      },
      {
        file: 'fixtures/ts/no-json-structured-clone.bad-2.ts',
        expect: [{ line: 3, column: 47 }]
      },
      {
        file: 'fixtures/ts/no-json-structured-clone.bad-3.ts',
        expect: [{ line: 3, column: 18 }]
      },
      { file: 'fixtures/ts/no-json-structured-clone.good-1.ts', expect: [] },
      { file: 'fixtures/ts/no-json-structured-clone.good-2.ts', expect: [] }
    ]
    const { tester, results } = await runCases(
      'lintsight/no-json-structured-clone',
      cases
    )
    for (const c of cases) tester.expect(results, c)
  })

  test('no-ignored-reduce-result', async () => {
    const cases: Case[] = [
      {
        file: 'fixtures/ts/no-ignored-reduce-result.bad-1.ts',
        expect: [{ line: 3, column: 3 }]
      },
      {
        file: 'fixtures/ts/no-ignored-reduce-result.bad-2.ts',
        expect: [{ line: 3, column: 3 }]
      },
      {
        file: 'fixtures/ts/no-ignored-reduce-result.bad-3.ts',
        expect: [{ line: 3, column: 3 }]
      },
      { file: 'fixtures/ts/no-ignored-reduce-result.good-1.ts', expect: [] },
      { file: 'fixtures/ts/no-ignored-reduce-result.good-2.ts', expect: [] }
    ]
    const { tester, results } = await runCases(
      'lintsight/no-ignored-reduce-result',
      cases
    )
    for (const c of cases) tester.expect(results, c)
  })

  test('no-empty-promise-catch', async () => {
    const cases: Case[] = [
      {
        file: 'fixtures/ts/no-empty-promise-catch.bad-1.ts',
        expect: [{ line: 3, column: 10 }]
      },
      {
        file: 'fixtures/ts/no-empty-promise-catch.bad-2.ts',
        expect: [{ line: 3, column: 10 }]
      },
      {
        file: 'fixtures/ts/no-empty-promise-catch.bad-3.ts',
        expect: [{ line: 3, column: 10 }]
      },
      { file: 'fixtures/ts/no-empty-promise-catch.good-1.ts', expect: [] },
      { file: 'fixtures/ts/no-empty-promise-catch.good-2.ts', expect: [] }
    ]
    const { tester, results } = await runCases(
      'lintsight/no-empty-promise-catch',
      cases
    )
    for (const c of cases) tester.expect(results, c)
  })

  test('no-async-constructor-call', async () => {
    const cases: Case[] = [
      {
        file: 'fixtures/ts/no-async-constructor-call.bad-1.ts',
        expect: [{ line: 6, column: 5 }]
      },
      {
        file: 'fixtures/ts/no-async-constructor-call.bad-2.ts',
        expect: [{ line: 7, column: 5 }]
      },
      {
        file: 'fixtures/ts/no-async-constructor-call.bad-3.ts',
        expect: [{ line: 6, column: 5 }]
      },
      { file: 'fixtures/ts/no-async-constructor-call.good-1.ts', expect: [] },
      { file: 'fixtures/ts/no-async-constructor-call.good-2.ts', expect: [] }
    ]
    const { tester, results } = await runCases(
      'lintsight/no-async-constructor-call',
      cases
    )
    for (const c of cases) tester.expect(results, c)
  })

  test('no-sync-io-in-async', async () => {
    const cases: Case[] = [
      {
        file: 'fixtures/ts/no-sync-io-in-async.bad-1.ts',
        expect: [{ line: 5, column: 10 }]
      },
      {
        file: 'fixtures/ts/no-sync-io-in-async.bad-2.ts',
        expect: [{ line: 5, column: 3 }]
      },
      {
        file: 'fixtures/ts/no-sync-io-in-async.bad-3.ts',
        expect: [
          { line: 5, column: 8 },
          { line: 6, column: 5 }
        ]
      },
      { file: 'fixtures/ts/no-sync-io-in-async.good-1.ts', expect: [] },
      { file: 'fixtures/ts/no-sync-io-in-async.good-2.ts', expect: [] }
    ]
    const { tester, results } = await runCases(
      'lintsight/no-sync-io-in-async',
      cases
    )
    for (const c of cases) tester.expect(results, c)
  })
})
