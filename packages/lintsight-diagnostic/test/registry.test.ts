/**
 * T1.11 注册表 CI 校验（design-m1 §4.6，双报消解 §3.6 的数据基础）：
 * - plugins/lintsight-rules 的每条规则必须在册，且四元组字段与 meta 一致；
 * - 注册表不得有指向不存在规则的陈旧条目；
 * - ruleId 命名空间契约（铁律 6）。
 * bun test 即 CI 门禁——新规则漏登记此处直接红。
 */
import { describe, expect, test } from 'bun:test'
import pluginDefault from '../../../plugins/lintsight-rules/index.js'
import { getRegistryEntry, registry, type Confidence } from '../src/registry'

const plugin = pluginDefault as unknown as {
  name: string
  rules: Record<
    string,
    {
      meta: {
        typeRequirement: string
        category: string
        confidence: Confidence
      }
    }
  >
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

  test('注册表 confidence 与 meta.confidence 一致（T1.19 误报标注反哺通道）', () => {
    for (const [key, rule] of Object.entries(plugin.rules)) {
      const entry = getRegistryEntry(`${PLUGIN_PREFIX}${key}`)
      expect(entry!.confidence, `${PLUGIN_PREFIX}${key}`).toBe(
        rule.meta.confidence
      )
    }
  })

  test('lintsight-js 条目不得指向不存在的插件规则（防陈旧条目）', () => {
    for (const entry of registry) {
      if (entry.owner !== 'lintsight-js') continue // oxlint-native / lintsight-engine 条目非插件承载
      const key = entry.ruleId.slice(PLUGIN_PREFIX.length)
      expect(
        plugin.rules[key],
        `注册表条目 ${entry.ruleId} 指向不存在的插件规则`
      ).toBeDefined()
    }
  })

  test('ruleId 命名空间契约（铁律 6 + design-m2 §4.2：lintsight/<name> 或 lintsight-engine/<name>）', () => {
    for (const entry of registry) {
      expect(entry.ruleId).toMatch(/^lintsight(-engine)?\/[a-z0-9-]+$/)
    }
  })

  test('supersedes 消解对（M2 §4.4）：仅 engine 条目可用，目标必须是在册 lintsight-js 规则', () => {
    for (const entry of registry) {
      if (!entry.supersedes) continue
      expect(entry.owner, `${entry.ruleId}.supersedes`).toBe('lintsight-engine')
      for (const target of entry.supersedes) {
        const t = getRegistryEntry(target)
        expect(
          t,
          `${entry.ruleId}.supersedes 目标 ${target} 未登记`
        ).toBeDefined()
        expect(t!.owner, `${entry.ruleId}.supersedes 目标 ${target}`).toBe(
          'lintsight-js'
        )
      }
    }
    // 消解锚点条目在册（no-path-traversal → no-non-literal-fs-filename）
    const pt = getRegistryEntry('lintsight-engine/no-path-traversal')
    expect(pt?.supersedes).toContain('lintsight/no-non-literal-fs-filename')
  })

  test('engine 条目 owner/detection 合法（lintsight-engine 条目 CI 校验）', () => {
    const engineEntries = registry.filter((e) => e.owner === 'lintsight-engine')
    expect(engineEntries.length).toBeGreaterThan(0)
    for (const entry of engineEntries) {
      expect(entry.ruleId).toMatch(/^lintsight-engine\//)
      expect(['syntax', 'local', 'taint']).toContain(entry.detection)
      expect(['active', 'retired']).toContain(entry.status)
    }
  })

  test('引擎规则面同步（M2.7 防漏登记）：引擎已实现规则必须在 JS 侧注册表在册', () => {
    // ⚠️ 在 crates/lintsight-engine/src/rules.rs 新增引擎规则时，必须同步在此登记
    // （M2.6 曾漏登记 no-command-injection/no-ssrf/no-prototype-pollution-merge，
    // 因缺反向校验未红——本断言为最小防线，规则面变化时更新此清单）
    for (const ruleId of [
      'lintsight-engine/no-eval',
      'lintsight-engine/no-path-traversal',
      'lintsight-engine/no-command-injection',
      'lintsight-engine/no-ssrf',
      'lintsight-engine/no-prototype-pollution-merge',
      'lintsight-engine/arch-boundaries'
    ]) {
      expect(getRegistryEntry(ruleId), `${ruleId} 未登记`).toBeDefined()
    }
  })
})
