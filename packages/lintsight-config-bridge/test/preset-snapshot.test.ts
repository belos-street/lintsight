/**
 * G12 预设快照：recommended / security / none 的规则覆盖面与 severity。
 * 数字口径：own 29（G9 后）+ builtin 9；effective 由 scripts/rule-count 验证（44）。
 */
import { describe, expect, test } from 'bun:test'
import {
  BUILTIN_PRESET_RULES,
  expandPreset,
  parseConfig,
  translate
} from '../src/index'
import { registry } from '@lintsight/diagnostic/registry'

const ownRuleIds = (rules: Record<string, unknown>): string[] =>
  Object.keys(rules).filter((k) => k.startsWith('lintsight/'))

const builtinRuleIds = (rules: Record<string, unknown>): string[] =>
  Object.keys(rules).filter((k) => k in BUILTIN_PRESET_RULES)

describe('G12 preset 快照', () => {
  test('recommended = 29 条自有 + 9 条 1b（G9 后）', () => {
    const { oxlintrc } = translate(
      { rules: {} },
      { rulesPluginPath: '/abs/rules/index.js' }
    )
    expect(ownRuleIds(oxlintrc.rules)).toHaveLength(29)
    expect(builtinRuleIds(oxlintrc.rules)).toHaveLength(9)
    expect(oxlintrc.rules['lintsight/no-hardcoded-credentials']).toBe('error')
    expect(oxlintrc.rules['lintsight/no-non-literal-fs-filename']).toBe('warn')
    expect(oxlintrc.rules['lintsight/no-jsx-dangerous-html']).toBe('error')
    expect(oxlintrc.rules['lintsight/no-unsafe-jsx-url']).toBe('warn')
    expect(oxlintrc.rules['eslint/no-new-func']).toBe('error')
    expect(oxlintrc.rules['eslint/no-await-in-loop']).toBeUndefined()
    expect(oxlintrc.rules['eslint/no-unsafe-finally']).toBeUndefined()
    expect(oxlintrc.rules['react/no-danger']).toBeUndefined()
  })

  test('security 预设：18 条自有安全规则 + 安全 1b 提升为 error；correctness 不变', () => {
    const rules = expandPreset('security')
    const security = registry.filter(
      (e) =>
        e.owner === 'lintsight-js' &&
        e.status === 'active' &&
        e.category === 'security'
    )
    expect(security).toHaveLength(18)
    for (const entry of security) {
      expect(rules[entry.ruleId], entry.ruleId).toBe('error')
    }
    expect(rules['lintsight/no-unsafe-jsx-url']).toBe('error')
    expect(rules['lintsight/no-sync-io-in-async']).toBe('warn')
    expect(rules['eslint/no-new-func']).toBe('error')
    expect(rules['eslint/no-prototype-builtins']).toBe('error')
    expect(rules['unicorn/no-document-cookie']).toBe('error')
    expect(rules['eslint/no-throw-literal']).toBe('error')
  })

  test('none = 空；显式 rules 覆盖预设', () => {
    expect(expandPreset('none')).toEqual({})
    const { oxlintrc } = translate(
      {
        preset: 'security',
        rules: { 'lintsight/no-non-literal-fs-filename': 'warn' }
      },
      { rulesPluginPath: '/abs/rules/index.js' }
    )
    expect(oxlintrc.rules['lintsight/no-non-literal-fs-filename']).toBe('warn')
    expect(oxlintrc.rules['lintsight/no-empty-catch']).toBe('error')
  })

  test('preset 非法值 → 配置错误', () => {
    const parsed = parseConfig('{ "preset": "strict" }')
    expect(parsed.ok).toBe(false)
    expect(parsed.errors[0]).toContain('preset')
    expect(parseConfig('{ "preset": "none" }').ok).toBe(true)
  })

  test('1b 清单均为 source/rule 形态（dead-rule 测试按两列匹配）', () => {
    for (const key of Object.keys(BUILTIN_PRESET_RULES)) {
      expect(key).toMatch(/^[a-z0-9-]+\/[a-z0-9-]+$/)
    }
  })
})
