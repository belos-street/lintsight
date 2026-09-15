/**
 * @lintsight/config-bridge（design-m1 §4.2）：
 * lintsight.config.json（JSONC）→ schema 校验 → 翻译为 .oxlintrc（写入 .lintsight-cache/，spawn 经 --config 传入）。
 * 附等价报告（✅ 直接映射 / 🔄 需手写 / ➖ 无对应）供迁移与评审。
 */

import { parseJsonc } from './jsonc'
import { builtinMapping } from './builtin-mapping'

// —— 配置类型 ——

type Severity = 'error' | 'warn' | 'off'
type RuleSetting = Severity | [Severity, Record<string, unknown>]

export interface LintsightOverride {
  files: string[]
  rules?: Record<string, RuleSetting>
  /** 引擎侧行为：触发 VueProcessor 虚拟化，不翻译进 .oxlintrc */
  processor?: string
}

export interface LintsightConfig {
  rules?: Record<string, RuleSetting>
  ignore?: string[]
  overrides?: LintsightOverride[]
}

// —— schema 校验（手写，报友好错误：字段路径 + 期望值） ——

const SEVERITIES = new Set(['error', 'warn', 'off'])

/** 规则键必须逐条列举（v0.1① 拍板：不支持通配 severity——oxlint 规则键无通配语义） */
function validateRuleKey(path: string, key: string, errors: string[]): void {
  if (key.includes('*'))
    errors.push(`${path}: 不支持通配规则键 '${key}'，规则须逐条列举`)
}

function validateRuleSetting(path: string, v: unknown, errors: string[]): void {
  if (typeof v === 'string') {
    if (!SEVERITIES.has(v))
      errors.push(
        `${path}: 期望 'error' | 'warn' | 'off' 或 [级别, 选项对象]，得到 '${v}'`
      )
    return
  }
  if (Array.isArray(v)) {
    if (
      v.length !== 2 ||
      !SEVERITIES.has(v[0]) ||
      typeof v[1] !== 'object' ||
      v[1] === null ||
      Array.isArray(v[1])
    ) {
      errors.push(
        `${path}: 数组形式期望 [级别, 选项对象]，如 ["error", { "entropy": true }]`
      )
    }
    return
  }
  errors.push(
    `${path}: 期望 'error' | 'warn' | 'off' 或 [级别, 选项对象]，得到 ${typeof v}`
  )
}

export function validateConfig(raw: unknown): {
  ok: boolean
  errors: string[]
  config: LintsightConfig | null
} {
  const errors: string[] = []
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ['根节点: 期望 JSON 对象'], config: null }
  }
  const o = raw as Record<string, unknown>
  const config: LintsightConfig = {}

  if (o.rules !== undefined) {
    if (
      typeof o.rules !== 'object' ||
      o.rules === null ||
      Array.isArray(o.rules)
    ) {
      errors.push('rules: 期望对象，键为规则 id，值为级别或 [级别, 选项]')
    } else {
      config.rules = {}
      for (const [k, v] of Object.entries(o.rules)) {
        validateRuleKey(`rules["${k}"]`, k, errors)
        validateRuleSetting(`rules["${k}"]`, v, errors)
      }
      if (errors.length === 0)
        config.rules = o.rules as Record<string, RuleSetting>
    }
  }
  if (o.ignore !== undefined) {
    if (
      !Array.isArray(o.ignore) ||
      o.ignore.some((x) => typeof x !== 'string')
    ) {
      errors.push('ignore: 期望字符串数组（glob）')
    } else {
      config.ignore = o.ignore as string[]
    }
  }
  if (o.overrides !== undefined) {
    if (!Array.isArray(o.overrides)) {
      errors.push('overrides: 期望数组')
    } else {
      config.overrides = []
      o.overrides.forEach((item, i) => {
        const p = `overrides[${i}]`
        if (typeof item !== 'object' || item === null || Array.isArray(item)) {
          errors.push(`${p}: 期望对象`)
          return
        }
        const it = item as Record<string, unknown>
        if (
          !Array.isArray(it.files) ||
          it.files.some((x) => typeof x !== 'string')
        ) {
          errors.push(`${p}.files: 期望字符串数组（glob）`)
          return
        }
        const entry: LintsightOverride = { files: it.files as string[] }
        if (it.processor !== undefined) {
          if (typeof it.processor !== 'string') {
            errors.push(`${p}.processor: 期望字符串（如 "@lintsight/vue"）`)
            return
          }
          entry.processor = it.processor
        }
        if (it.rules !== undefined) {
          if (
            typeof it.rules !== 'object' ||
            it.rules === null ||
            Array.isArray(it.rules)
          ) {
            errors.push(`${p}.rules: 期望对象`)
            return
          }
          for (const [k, v] of Object.entries(it.rules)) {
            validateRuleKey(`${p}.rules["${k}"]`, k, errors)
            validateRuleSetting(`${p}.rules["${k}"]`, v, errors)
          }
          entry.rules = it.rules as Record<string, RuleSetting>
        }
        config.overrides!.push(entry)
      })
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    config: errors.length === 0 ? config : null
  }
}

export function parseConfig(text: string): {
  ok: boolean
  errors: string[]
  config: LintsightConfig | null
} {
  let raw: unknown
  try {
    raw = parseJsonc(text)
  } catch (e) {
    return {
      ok: false,
      errors: [`配置不是合法 JSONC：${(e as Error).message}`],
      config: null
    }
  }
  return validateConfig(raw)
}

// —— 等价报告（v0 简化口径：lintsight/* → 自有插件直译；其余 → 内置直译；结构不合法 → 无对应） ——

export interface EquivalenceRow {
  rule: string
  status: '✅ 直接映射' | '🔄 需手写' | '➖ 无对应'
  note: string
}

export function equivalenceReport(config: LintsightConfig): EquivalenceRow[] {
  const rows: EquivalenceRow[] = []
  for (const rule of Object.keys(config.rules ?? {})) {
    rows.push(
      rule.startsWith('lintsight/')
        ? { rule, status: '✅ 直接映射', note: '自有 JS Plugin 规则' }
        : { rule, status: '✅ 直接映射', note: 'oxlint 内置规则原名直译' }
    )
  }
  for (const [i, o] of (config.overrides ?? []).entries()) {
    if (o.processor) {
      rows.push({
        rule: `overrides[${i}].processor=${o.processor}`,
        status: '🔄 需手写',
        note: 'processor 为引擎侧行为（VueProcessor 虚拟化），不进 .oxlintrc'
      })
    }
  }
  return rows
}

// —— 翻译 ——

export interface OxlintrcDoc {
  jsPlugins: string[]
  categories: Record<string, 'allow' | 'error' | 'warn'>
  rules: Record<string, unknown>
  ignorePatterns: string[]
  overrides?: { files: string[]; rules?: Record<string, unknown> }[]
}

/** 规则设置：'off' → oxlint 的 'allow'（实测合法值集合为 allow/error/warn） */
function translateSetting(v: RuleSetting): unknown {
  if (typeof v === 'string') return v === 'off' ? 'allow' : v
  const [level, options] = v
  return [level === 'off' ? 'allow' : level, options]
}

export function translate(
  config: LintsightConfig,
  opts: { rulesPluginPath: string }
): { oxlintrc: OxlintrcDoc; equivalent: EquivalenceRow[] } {
  const rules: Record<string, unknown> = { ...builtinMapping.rules }
  for (const [k, v] of Object.entries(config.rules ?? {}))
    rules[k] = translateSetting(v)

  const overrides = (config.overrides ?? [])
    .filter((o) => o.rules && Object.keys(o.rules).length > 0)
    .map((o) => ({
      files: o.files,
      rules: Object.fromEntries(
        Object.entries(o.rules!).map(([k, v]) => [k, translateSetting(v)])
      )
    }))

  const oxlintrc: OxlintrcDoc = {
    jsPlugins: [opts.rulesPluginPath],
    categories: { ...builtinMapping.categories },
    rules,
    ignorePatterns: [
      ...builtinMapping.ignorePatterns,
      ...(config.ignore ?? [])
    ],
    ...(overrides.length > 0 ? { overrides } : {})
  }
  return { oxlintrc, equivalent: equivalenceReport(config) }
}

// —— 文件面 ——

import { existsSync } from 'node:fs'
import path from 'node:path'

/** 定位自有规则插件（jsPlugins 需要）：monorepo dev 形态 → plugins/；业务项目形态 → node_modules 包路径 */
export function resolveRulesPluginPath(projectRoot: string): string {
  const candidates = [
    path.join(projectRoot, 'plugins/lintsight-rules/index.js'),
    path.join(projectRoot, 'node_modules/@lintsight/rules-core/dist/index.js')
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  throw new Error(
    'lintsight 规则插件未找到：期望 plugins/lintsight-rules/index.js（monorepo）或 node_modules/@lintsight/rules-core（业务项目）'
  )
}

/** 解析生效的 lintsight 配置文件：显式路径 > cwd/lintsight.config.json > null（回落 oxlint 自动发现） */
export function resolveConfigFile(
  cwd: string,
  explicit?: string
): string | null {
  const target = explicit ?? path.join(cwd, 'lintsight.config.json')
  const abs = path.resolve(cwd, target)
  return existsSync(abs) ? abs : null
}

export interface GeneratedConfig {
  /** 生成的 .oxlintrc 绝对路径（.lintsight-cache/oxlintrc.json） */
  oxlintrcPath: string
  equivalent: EquivalenceRow[]
}

/** 生成 .oxlintrc 到 .lintsight-cache/（不污染项目根），返回路径与等价报告 */
export async function generateOxlintrc(
  cwd: string,
  configPath: string,
  cacheDir: string
): Promise<GeneratedConfig> {
  const text = await Bun.file(configPath).text()
  const parsed = parseConfig(text)
  if (!parsed.ok || !parsed.config) {
    throw new Error(
      `lintsight 配置无效（${configPath}）:\n${parsed.errors.map((e) => `  - ${e}`).join('\n')}`
    )
  }
  const rulesPluginPath = resolveRulesPluginPath(cwd)
  const { oxlintrc, equivalent } = translate(parsed.config, { rulesPluginPath })
  const oxlintrcPath = path.join(cacheDir, 'oxlintrc.json')
  await Bun.write(oxlintrcPath, JSON.stringify(oxlintrc, null, 2))
  return { oxlintrcPath, equivalent }
}
