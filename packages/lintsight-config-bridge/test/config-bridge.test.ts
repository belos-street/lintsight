/**
 * T1.5~T1.7 config-bridge 单测：JSONC 解析 / schema 友好错误 / 翻译 / 等价报告 / 生成。
 * overrides 与 jsPlugins 绝对路径的 oxlint 侧实测见 T1.8（设计文档 §6/§9）。
 */
import { afterAll, describe, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import {
  equivalenceReport,
  generateOxlintrc,
  parseConfig,
  resolveRulesPluginPath,
  translate
} from '../src/index'

const PROJECT_ROOT = new URL('../../../', import.meta.url).pathname

afterAll(async () => {
  await rm(`${PROJECT_ROOT}.lintsight-cache/config-bridge-test`, {
    recursive: true,
    force: true
  })
})

describe('JSONC 解析（stripJsonComments / 尾逗号）', () => {
  test('注释剥离，字符串内 // 不误伤', () => {
    const r = parseConfig(`{
      // 行注释
      "rules": { "lintsight/a": "error" }, /* 块注释 */
      "ignore": ["http://keep-in-string/**"]
    }`)
    expect(r.ok).toBeTrue()
    expect(r.config!.ignore).toEqual(['http://keep-in-string/**'])
  })
  test('尾随逗号容忍', () => {
    const r = parseConfig(`{ "rules": { "a": "off", }, "ignore": [], }`)
    expect(r.ok).toBeTrue()
    expect(r.config!.rules!['a']).toBe('off')
  })
  test('字符串内尾逗号不剥离', () => {
    const r = parseConfig(`{ "ignore": ["a,b,"] }`)
    expect(r.config!.ignore).toEqual(['a,b,'])
  })
})

describe('schema 校验（友好错误含字段路径）', () => {
  test('非法 severity → 报出 rules["x"] 路径与期望值', () => {
    const r = parseConfig('{ "rules": { "lintsight/x": "fatal" } }')
    expect(r.ok).toBeFalse()
    expect(r.errors[0]).toContain('rules["lintsight/x"]')
    expect(r.errors[0]).toContain("'error' | 'warn' | 'off'")
  })
  test('非对象根 / overrides.files 类型错误', () => {
    expect(parseConfig('[]').ok).toBeFalse()
    const r = parseConfig('{ "overrides": [{ "files": "not-array" }] }')
    expect(r.errors[0]).toContain('overrides[0].files')
  })
  test('数组选项形式合法', () => {
    const r = parseConfig(
      '{ "rules": { "lintsight/x": ["error", { "entropy": true }] } }'
    )
    expect(r.ok).toBeTrue()
  })
  test('通配规则键显式拒绝（v0.1① 拍板）', () => {
    const r = parseConfig('{ "rules": { "lintsight/*": "warn" } }')
    expect(r.ok).toBeFalse()
    expect(r.errors[0]).toContain('不支持通配规则键')
  })
})

describe('arch 配置校验（T2.4）', () => {
  test('合法 zones 通过并透传', () => {
    const r = parseConfig(`{
      "arch": { "zones": [
        { "name": "core", "match": ["src/core/**"], "allow": [] },
        { "name": "ui", "match": ["src/ui/**"], "allow": ["src/core/**"] }
      ] }
    }`)
    expect(r.ok).toBeTrue()
    expect(r.config!.arch!.zones).toHaveLength(2)
    expect(r.config!.arch!.zones[1]).toEqual({
      name: 'ui',
      match: ['src/ui/**'],
      allow: ['src/core/**']
    })
  })

  test('match 空数组 / name 缺失 / zones 非数组 → 字段路径报错', () => {
    const empty = parseConfig(
      '{ "arch": { "zones": [{ "name": "x", "match": [], "allow": [] }] } }'
    )
    expect(empty.ok).toBeFalse()
    expect(empty.errors[0]).toContain('arch.zones[0].match')

    const noName = parseConfig(
      '{ "arch": { "zones": [{ "match": ["a/**"] }] } }'
    )
    expect(noName.ok).toBeFalse()
    expect(noName.errors[0]).toContain('arch.zones[0].name')

    const badZones = parseConfig('{ "arch": { "zones": "nope" } }')
    expect(badZones.ok).toBeFalse()
    expect(badZones.errors[0]).toContain('arch.zones')
  })

  test('arch 缺省 → undefined（规则不注册）', () => {
    const r = parseConfig('{ "rules": {} }')
    expect(r.config!.arch).toBeUndefined()
  })

  test('typeAware 校验（T2.5 剩余项）：布尔合法 / 非布尔报错 / 缺省 undefined', () => {
    const ok = parseConfig('{ "typeAware": true }')
    expect(ok.ok).toBeTrue()
    expect(ok.config!.typeAware).toBe(true)

    const bad = parseConfig('{ "typeAware": "yes" }')
    expect(bad.ok).toBeFalse()
    expect(bad.errors[0]).toContain('typeAware')

    const absent = parseConfig('{ "rules": {} }')
    expect(absent.config!.typeAware).toBeUndefined()
  })
})

describe('翻译器', () => {
  const config = parseConfig(`{
    "rules": { "lintsight/a": "off", "lintsight/b": ["error", { "x": 1 }] },
    "ignore": ["dist/**"],
    "overrides": [
      { "files": ["**/*.vue"], "processor": "@lintsight/vue" },
      { "files": ["src/legacy/**"], "rules": { "lintsight/a": "warn" } }
    ]
  }`).config!

  test("'off' → 'allow'（oxlint 合法值），数组选项保真", () => {
    const { oxlintrc } = translate(config, {
      rulesPluginPath: '/abs/rules/index.js'
    })
    expect(oxlintrc.rules['lintsight/a']).toBe('allow')
    expect(oxlintrc.rules['lintsight/b']).toEqual(['error', { x: 1 }])
  })

  test('builtin-mapping categories 合入；ignore 合并', () => {
    const { oxlintrc } = translate(config, {
      rulesPluginPath: '/abs/rules/index.js'
    })
    expect(oxlintrc.categories).toEqual({ correctness: 'error' })
    expect(oxlintrc.ignorePatterns).toEqual(['dist/**'])
  })

  test('overrides：processor 条目跳过（引擎侧行为），rules 条目照译', () => {
    const { oxlintrc } = translate(config, {
      rulesPluginPath: '/abs/rules/index.js'
    })
    expect(oxlintrc.overrides).toEqual([
      { files: ['src/legacy/**'], rules: { 'lintsight/a': 'warn' } }
    ])
  })

  test('jsPlugins 透传（实测支持绝对路径）', () => {
    const { oxlintrc } = translate(config, {
      rulesPluginPath: '/abs/rules/index.js'
    })
    expect(oxlintrc.jsPlugins).toEqual(['/abs/rules/index.js'])
  })
})

describe('等价报告', () => {
  test('lintsight/* → ✅ 自有插件；processor → 🔄 需手写', () => {
    const rows = equivalenceReport({
      rules: { 'lintsight/a': 'error' },
      ignore: [],
      overrides: [{ files: ['**/*.vue'], processor: '@lintsight/vue' }]
    })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({
      rule: 'lintsight/a',
      status: '✅ 直接映射',
      note: '自有 JS Plugin 规则'
    })
    expect(rows[1].status).toBe('🔄 需手写')
  })
})

describe('文件面', () => {
  test('resolveRulesPluginPath：monorepo dev 形态命中 plugins/', () => {
    const p = resolveRulesPluginPath(PROJECT_ROOT)
    expect(p.endsWith('plugins/lintsight-rules/index.js')).toBeTrue()
  })

  test('generateOxlintrc：写入 cache 目录，规则与 jsPlugins 落盘', async () => {
    const cacheDir = `${PROJECT_ROOT}.lintsight-cache/config-bridge-test`
    const out = await generateOxlintrc(
      PROJECT_ROOT,
      `${PROJECT_ROOT}lintsight.config.json`,
      cacheDir
    )
    expect(out.oxlintrcPath.startsWith(cacheDir)).toBeTrue()
    const doc = (await Bun.file(out.oxlintrcPath).json()) as {
      rules: Record<string, unknown>
      jsPlugins: string[]
    }
    expect(doc.rules['lintsight/no-empty-catch']).toBe('error')
    expect(
      doc.jsPlugins[0].endsWith('plugins/lintsight-rules/index.js')
    ).toBeTrue()
    expect(
      out.equivalent.some((r) => r.rule === 'lintsight/no-empty-catch')
    ).toBeTrue()
  })
})
