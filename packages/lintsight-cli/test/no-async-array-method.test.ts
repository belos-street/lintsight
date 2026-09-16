/**
 * no-async-array-method 契约（P0 正确性 #4，v0.1① 定稿）。
 * 3 invalid + 2 valid：forEach/map/reduce 变体、方法链换行、Promise.all 替代写法、字符串/注释干扰。
 * 走 oxlint 自动发现根 .oxlintrc.json（dev 配置含 jsPlugins）。
 */
import { describe, expect, test } from 'bun:test'
import { defineRuleTester } from '@lintsight/rule-sdk/testing'

const cases = [
  {
    file: 'fixtures/ts/no-async-array-method.bad-1.ts',
    expect: [{ line: 3, column: 3 }]
  },
  {
    file: 'fixtures/ts/no-async-array-method.bad-2.ts',
    expect: [{ line: 3, column: 10 }]
  },
  {
    file: 'fixtures/ts/no-async-array-method.bad-3.ts',
    expect: [{ line: 3, column: 10 }]
  },
  { file: 'fixtures/ts/no-async-array-method.good-1.ts', expect: [] },
  { file: 'fixtures/ts/no-async-array-method.good-2.ts', expect: [] }
]

const tester = defineRuleTester({ ruleId: 'lintsight/no-async-array-method' })
const results = await tester.run(cases)

describe('lintsight/no-async-array-method', () => {
  for (const c of cases) {
    test(c.file, () => {
      tester.expect(results, c)
      expect(true).toBe(true)
    })
  }
})
