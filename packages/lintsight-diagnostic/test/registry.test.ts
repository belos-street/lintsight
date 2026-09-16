/**
 * T1.11 注册表 CI 校验（design-m1 §4.6，双报消解 §3.6 的数据基础）：
 * - plugins/lintsight-rules 的每条规则必须在册，且四元组字段与 meta 一致；
 * - 注册表不得有指向不存在规则的陈旧条目；
 * - ruleId 命名空间契约（铁律 6）。
 * bun test 即 CI 门禁——新规则漏登记此处直接红。
 */
import { describe, expect, test } from 'bun:test'
import pluginDefault from '../../../plugins/lintsight-rules/index.js'
import { getRegistryEntry, registry } from '../src/registry'

const plugin = pluginDefault as unknown as {
  name: string
  rules: Record<string, { meta: { typeRequirement: string; category: string } }>
}
const PLUGIN_PREFIX = `${plugin.name}/`

describe('规则注册表 CI 校验（T1.11）', () => {
  test('插件每条规则必须在册，owner=lintsight-js，状态合法', () => {
    const pluginRuleIds = Object.keys(plugin.rules).map(
      (k) => `${PLUGIN_PREFIX}${k}`
    )
    expect(pluginRuleIds.length).toBeGreaterThan(0)
    for (const ruleId of pluginRuleIds) {
      const entry = getRegistryEntry(ruleId)
      expect(
        entry,
        `${ruleId} 未在注册表登记——新增规则必须同步登记四元组`
      ).toBeDefined()
      expect(entry!.owner).toBe('lintsight-js')
      expect(['active', 'retired']).toContain(entry!.status)
    }
  })

  test('注册表 detection 层与 meta.typeRequirement 映射一致（none→syntax / local→local）', () => {
    for (const [key, rule] of Object.entries(plugin.rules)) {
      const entry = getRegistryEntry(`${PLUGIN_PREFIX}${key}`)
      const expected =
        rule.meta.typeRequirement === 'local' ? 'local' : 'syntax'
      expect(entry!.detection, `${PLUGIN_PREFIX}${key}`).toBe(expected)
    }
  })

  test('lintsight-js 条目不得指向不存在的插件规则（防陈旧条目）', () => {
    for (const entry of registry) {
      if (entry.owner !== 'lintsight-js') continue // oxlint-native 条目描述接管对，M2 生效
      const key = entry.ruleId.slice(PLUGIN_PREFIX.length)
      expect(
        plugin.rules[key],
        `注册表条目 ${entry.ruleId} 指向不存在的插件规则`
      ).toBeDefined()
    }
  })

  test('ruleId 命名空间契约（铁律 6：lintsight/<rule-name>）', () => {
    for (const entry of registry) {
      expect(entry.ruleId).toMatch(/^lintsight\/[a-z0-9-]+$/)
    }
  })
})
