/**
 * G9 TSX/JSX 契约：两条 JSX sink 规则的 RuleTester + pipeline/Vue 解析契约。
 */
import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { defineRuleTester } from '@lintsight/rule-sdk/testing'
import { runPipeline } from '../src/pipeline'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))

interface Case {
  file: string
  expect: { line: number; column: number }[]
}

async function runCases(ruleId: string, cases: Case[]) {
  const tester = defineRuleTester({ ruleId })
  const results = await tester.run(cases, { cwd: ROOT })
  for (const c of cases) tester.expect(results, c)
}

describe('G9 JSX sink 规则契约', () => {
  test('no-jsx-dangerous-html：.tsx/.jsx bad + good', async () => {
    await runCases('lintsight/no-jsx-dangerous-html', [
      {
        file: 'fixtures/tsx/no-jsx-dangerous-html.bad-1.tsx',
        expect: [{ line: 3, column: 15 }]
      },
      {
        file: 'fixtures/jsx/no-jsx-dangerous-html.bad-1.jsx',
        expect: [{ line: 3, column: 15 }]
      },
      {
        file: 'fixtures/tsx/no-jsx-dangerous-html.good-1.tsx',
        expect: []
      },
      {
        file: 'fixtures/jsx/no-jsx-dangerous-html.good-1.jsx',
        expect: []
      }
    ])
  })

  test('no-unsafe-jsx-url：动态/危险 scheme 命中，大小写/空白归一化', async () => {
    await runCases('lintsight/no-unsafe-jsx-url', [
      {
        file: 'fixtures/tsx/no-unsafe-jsx-url.bad-1.tsx',
        expect: [{ line: 3, column: 13 }]
      },
      {
        file: 'fixtures/tsx/no-unsafe-jsx-url.bad-2.tsx',
        expect: [{ line: 3, column: 13 }]
      },
      {
        file: 'fixtures/tsx/no-unsafe-jsx-url.bad-3.tsx',
        expect: [{ line: 3, column: 18 }]
      },
      {
        file: 'fixtures/tsx/no-unsafe-jsx-url.bad-4.tsx',
        expect: [{ line: 3, column: 13 }]
      },
      {
        file: 'fixtures/tsx/no-unsafe-jsx-url.bad-5.tsx',
        expect: [{ line: 3, column: 15 }]
      },
      {
        file: 'fixtures/tsx/no-unsafe-jsx-url.bad-6.tsx',
        expect: [{ line: 3, column: 13 }]
      },
      {
        file: 'fixtures/tsx/no-unsafe-jsx-url.bad-7.tsx',
        expect: [{ line: 3, column: 13 }]
      },
      {
        file: 'fixtures/tsx/no-unsafe-jsx-url.bad-8.tsx',
        expect: [{ line: 3, column: 13 }]
      },
      {
        file: 'fixtures/tsx/no-unsafe-jsx-url.bad-9.tsx',
        expect: [{ line: 3, column: 13 }]
      },
      {
        file: 'fixtures/tsx/no-unsafe-jsx-url.bad-10.tsx',
        expect: [{ line: 3, column: 13 }]
      },
      {
        file: 'fixtures/tsx/no-unsafe-jsx-url.bad-11.tsx',
        expect: [{ line: 3, column: 13 }]
      },
      {
        file: 'fixtures/jsx/no-unsafe-jsx-url.bad-1.jsx',
        expect: [{ line: 3, column: 13 }]
      },
      {
        file: 'fixtures/tsx/no-unsafe-jsx-url.good-1.tsx',
        expect: []
      },
      {
        file: 'fixtures/tsx/no-unsafe-jsx-url.good-2.tsx',
        expect: []
      },
      {
        file: 'fixtures/tsx/no-unsafe-jsx-url.good-3.tsx',
        expect: []
      },
      {
        file: 'fixtures/tsx/no-unsafe-jsx-url.good-4.tsx',
        expect: []
      },
      {
        file: 'fixtures/tsx/no-unsafe-jsx-url.good-5.tsx',
        expect: []
      },
      {
        file: 'fixtures/tsx/no-unsafe-jsx-url.good-6.tsx',
        expect: []
      },
      {
        file: 'fixtures/tsx/no-unsafe-jsx-url.good-7.tsx',
        expect: []
      },
      {
        file: 'fixtures/jsx/no-unsafe-jsx-url.good-1.jsx',
        expect: []
      },
      {
        file: 'fixtures/jsx/no-unsafe-jsx-url.good-2.jsx',
        expect: []
      }
    ])
  })

  test('pipeline：TSX/JSX 解析无 parse-error，重跑确定', async () => {
    const r1 = await runPipeline(['fixtures/tsx', 'fixtures/jsx'], {
      cwd: ROOT,
      cache: false
    })
    const r2 = await runPipeline(['fixtures/tsx', 'fixtures/jsx'], {
      cwd: ROOT,
      cache: false
    })
    expect(r1.report).not.toBeNull()
    expect(JSON.stringify(r2.report)).toBe(JSON.stringify(r1.report))
    const diags = r1.report!.diagnostics
    expect(diags.some((d) => d.ruleId === 'internal/parse-error')).toBe(false)
    expect(
      diags.some((d) => d.ruleId === 'lintsight/no-jsx-dangerous-html')
    ).toBe(true)
    expect(diags.some((d) => d.ruleId === 'lintsight/no-unsafe-jsx-url')).toBe(
      true
    )
  })

  test('Vue <script lang="tsx">：回映射原 .vue 路径', async () => {
    const r = await runPipeline(['fixtures/vue/jsx-sink.vue'], {
      cwd: ROOT,
      cache: false
    })
    const hit = r.report?.diagnostics.find(
      (d) => d.ruleId === 'lintsight/no-unsafe-jsx-url'
    )
    expect(hit).toBeDefined()
    expect(hit!.file).toBe('fixtures/vue/jsx-sink.vue')
    expect(hit!.file).not.toContain('.lintsight-')
    expect(hit!.span.line).toBe(7)
  })
})
