#!/usr/bin/env bun
/**
 * G12 规则面三口径计数：
 * - registered：registry active 条目（JS 27 + engine 9）
 * - enabled：生成 oxlintrc 中非 allow 的规则（own 自有 JS + builtin 内置/1b）
 * - effective：enabled（own+builtin）+ 引擎常驻 6（1b 已实际运行，必须计入）
 *
 * 用法：bun run rule-count [--config lintsight.config.json]
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  parseConfig,
  translate,
  type LintsightConfig
} from '../packages/lintsight-config-bridge/src/index'
import { registry } from '../packages/lintsight-diagnostic/src/registry'

const ROOT = fileURLToPath(new URL('../', import.meta.url))

/** 引擎常驻 6 条（其余 3 条 arch/import-cycle/deep-import 为配置驱动） */
export const ENGINE_RESIDENT = [
  'lintsight-engine/no-eval',
  'lintsight-engine/no-path-traversal',
  'lintsight-engine/no-command-injection',
  'lintsight-engine/no-ssrf',
  'lintsight-engine/no-prototype-pollution-merge',
  'lintsight-engine/no-open-redirect'
] as const

export interface RuleCounts {
  registered: {
    js: number
    correctness: number
    security: number
    engine: number
  }
  enabled: { own: number; builtin: number }
  effective: number
}

function isEnabled(v: unknown): boolean {
  if (typeof v === 'string') return v !== 'allow'
  if (Array.isArray(v)) return v[0] !== 'allow'
  return v !== undefined
}

export function computeCounts(config: LintsightConfig): RuleCounts {
  const active = registry.filter((e) => e.status === 'active')
  const js = active.filter((e) => e.owner === 'lintsight-js')
  const { oxlintrc } = translate(config, {
    rulesPluginPath: '<rule-count>'
  })
  let own = 0
  let builtin = 0
  for (const [ruleId, setting] of Object.entries(oxlintrc.rules)) {
    if (!isEnabled(setting)) continue
    if (ruleId.startsWith('lintsight-engine/')) continue
    if (ruleId.startsWith('lintsight/')) own++
    else builtin++
  }
  return {
    registered: {
      js: js.length,
      correctness: js.filter((e) => e.category === 'correctness').length,
      security: js.filter((e) => e.category === 'security').length,
      engine: active.filter((e) => e.owner === 'lintsight-engine').length
    },
    enabled: { own, builtin },
    effective: own + builtin + ENGINE_RESIDENT.length
  }
}

function main(): void {
  const args = process.argv.slice(2)
  const idx = args.indexOf('--config')
  const configPath =
    idx >= 0 ? args[idx + 1] : `${ROOT}/lintsight.config.json`
  let config: LintsightConfig = {}
  try {
    const parsed = parseConfig(readFileSync(configPath, 'utf8'))
    if (!parsed.ok || !parsed.config) {
      console.error(`rule-count: 配置无效（${configPath}）`)
      process.exit(2)
    }
    config = parsed.config
  } catch {
    console.error(`rule-count: 无配置（${configPath}），按缺省 recommended 计数`)
  }
  const c = computeCounts(config)
  console.log(
    `registered: js=${c.registered.js} (correctness=${c.registered.correctness} security=${c.registered.security}) engine=${c.registered.engine}`
  )
  console.log(`enabled: own=${c.enabled.own} builtin=${c.enabled.builtin}`)
  console.log(
    `effective: ${c.enabled.own} + ${c.enabled.builtin} + engine-resident ${ENGINE_RESIDENT.length} = ${c.effective}`
  )
}

if (import.meta.main) main()
