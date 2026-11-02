import { describe, expect, test } from 'bun:test'
import { computeCounts, ENGINE_RESIDENT } from './rule-count'

describe('G12 rule-count 三口径', () => {
  test('recommended = own 29 + builtin 9 + engine 6 = 44（G9 后）', () => {
    const c = computeCounts({})
    expect(c.registered).toEqual({
      js: 29,
      correctness: 11,
      security: 18,
      engine: 9
    })
    expect(c.enabled).toEqual({ own: 29, builtin: 9 })
    expect(c.effective).toBe(44)
    expect(ENGINE_RESIDENT).toHaveLength(6)
  })

  test('none = own 0 + builtin 0 + engine 6', () => {
    const c = computeCounts({ preset: 'none' })
    expect(c.enabled).toEqual({ own: 0, builtin: 0 })
    expect(c.effective).toBe(6)
  })

  test('显式 off 从 enabled 中扣除', () => {
    const c = computeCounts({
      preset: 'recommended',
      rules: { 'lintsight/no-empty-catch': 'off', 'eslint/no-new-func': 'off' }
    })
    expect(c.enabled).toEqual({ own: 28, builtin: 8 })
    expect(c.effective).toBe(28 + 8 + 6)
  })
})
