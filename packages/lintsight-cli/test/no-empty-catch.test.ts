/**
 * RuleTester 契约测试（T1.9 迁移到 @lintsight/rule-sdk tester，dogfood）。
 * no-empty-catch：3 invalid + 2 valid，覆盖边界矩阵；断言只看 lintsight/no-empty-catch 诊断。
 * 走 oxlint 自动发现根 .oxlintrc.json（dev 配置含 jsPlugins）。
 */
import { describe, expect, test } from 'bun:test'
import { defineRuleTester } from '@lintsight/rule-sdk/testing'

const cases = [
  {
    file: 'fixtures/ts/no-empty-catch.bad-1.ts',
    expect: [{ line: 5, column: 5 }]
  },
  {
    file: 'fixtures/ts/no-empty-catch.bad-2.ts',
    expect: [{ line: 5, column: 5 }]
  },
  {
    file: 'fixtures/ts/no-empty-catch.bad-3.ts',
    expect: [
      { line: 8, column: 7 }, // 内层 catch
      { line: 10, column: 5 } // 外层 catch
    ]
  },
  { file: 'fixtures/ts/no-empty-catch.good-1.ts', expect: [] },
  { file: 'fixtures/ts/no-empty-catch.good-2.ts', expect: [] }
]

const tester = defineRuleTester({ ruleId: 'lintsight/no-empty-catch' })
const results = await tester.run(cases)

describe('lintsight/no-empty-catch (oxlint JS Plugin · alpha)', () => {
  for (const c of cases) {
    test(c.file, () => {
      tester.expect(results, c)
      // 显式断言经 expect 内部校验（数量/位置/命名空间/severity）
      expect(true).toBe(true)
    })
  }
})
