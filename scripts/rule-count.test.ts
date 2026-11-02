import { describe, expect, test } from 'bun:test'
import { computeCounts, ENGINE_RESIDENT } from './rule-count'

describe('G12 rule-count 三口径', () => {
  test('recommended = own 27 + builtin 9 + engine 6 = 42', () => {
    const c = computeCounts({})
    expect(c.registered).toEqual({
      js: 27,
      correctness: 11,
      security: 16,
      engine: 9
    })
    expect(c.enabled).toEqual({ own: 27, builtin: 9 })
    expect(c.effective).toBe(42)
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
    expect(c.enabled).toEqual({ own: 26, builtin: 8 })
    expect(c.effective).toBe(26 + 8 + 6)
  })
})
