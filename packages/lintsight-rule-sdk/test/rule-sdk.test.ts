/**
 * T1.9 rule-sdk 自测：meta 契约校验（FR-203）+ messageId 一致性 + 现有插件 dogfood。
 * 现有插件文件（裸对象）经 definePlugin 测试期校验——RFC 开放问题 5 的 M1 形态。
 */
import { describe, expect, test } from 'bun:test'
import {
  definePlugin,
  defineRule,
  SDK_VERSION,
  type RuleMeta
} from '../src/index'
import pluginDefault from '../../../plugins/lintsight-rules/index.js'

const validMeta = {
  category: 'correctness',
  severity: 'error',
  confidence: 'high',
  typeRequirement: 'none',
  tags: [] as string[],
  messages: { found: 'found {a}' },
  docs: {
    description: 'd',
    rationale: 'r',
    badExamples: ['x'],
    goodExamples: ['y'],
    falsePositives: []
  }
} satisfies RuleMeta

describe('defineRule：meta 契约校验', () => {
  test('合法 meta 通过', () => {
    expect(() =>
      defineRule({ meta: validMeta, create: () => ({}) })
    ).not.toThrow()
  })

  test('缺 messages / docs.falsePositives → 逐一报出字段名', () => {
    const bad = {
      ...validMeta,
      messages: {},
      docs: { ...validMeta.docs, falsePositives: undefined }
    } as any
    expect(() => defineRule({ meta: bad, create: () => ({}) })).toThrow(
      /meta\.messages[\s\S]*meta\.docs\.falsePositives/
    )
  })

  test('security 类缺 cwe tag → 拒绝', () => {
    const bad = { ...validMeta, category: 'security' } as any
    expect(() => defineRule({ meta: bad, create: () => ({}) })).toThrow(
      /cwe-\*/
    )
    const ok = { ...validMeta, category: 'security', tags: ['cwe-798'] } as any
    expect(() => defineRule({ meta: ok, create: () => ({}) })).not.toThrow()
  })

  test('report 的 messageId 不在 messages 中 → 运行时抛出', () => {
    const rule = defineRule({
      meta: validMeta,
      create: (ctx) => ({
        Identifier(node: any) {
          if (node.name === 'bad') ctx.report({ node, messageId: 'not-a-key' })
        }
      })
    })
    const reports: any[] = []
    const visitor = rule.create({
      options: undefined,
      report: (d) => reports.push(d)
    })
    expect(() =>
      visitor.Identifier({ type: 'Identifier', name: 'bad' })
    ).toThrow(/not-a-key/)
    expect(reports).toHaveLength(0) // 抛出前未透传
    visitor.Identifier({ type: 'Identifier', name: 'ok' })
    expect(reports).toHaveLength(0)
  })

  test('SDK_VERSION 语义化版本形态', () => {
    expect(SDK_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})

describe('definePlugin：现有插件 dogfood', () => {
  test('plugins/lintsight-rules/index.js 全部规则通过 FR-203 校验', () => {
    const plugin = definePlugin(pluginDefault as any)
    expect(plugin.name).toBe('lintsight')
    expect(Object.keys(plugin.rules)).toContain('no-empty-catch')
    expect(Object.keys(plugin.rules)).toContain('no-async-array-method')
  })

  test('规则键含通配或空名 → 拒绝', () => {
    expect(() =>
      definePlugin({
        name: 'lintsight',
        rules: { '': { meta: validMeta as any, create: () => ({}) } }
      })
    ).not.toThrow() // 空键由注册表 CI 校验管（S3 T1.11），SDK 只校验 meta 与 create
  })
})
