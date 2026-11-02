/**
 * G12 预设展开（单一事实源 = registry）。
 * - recommended：全部 active 自有 JS 规则（severity=defaultSeverity）+ 1b 内置清单
 * - security：同覆盖面，安全类（自有 category=security / 1b security=true）提升为 error
 * - none：空（仅 builtinMapping + 显式 rules）
 *
 * ⚠️ 1b 清单按 oxlint 1.83.0 实测维护：
 * - `react/no-danger` 不存在 → 不写入（死配置）；
 * - `eslint/no-unsafe-finally` 已由 correctness 默认启用 → 不重复；
 * - `typescript/no-misused-promises` 依赖 --type-aware → 不进默认预设。
 * `preset-snapshot.test.ts` 会对 `oxlint --rules` 做 source+name 存在性校验。
 */
import { registry, type RegistryEntry } from '@lintsight/diagnostic/registry'
import type { RuleSetting } from './index'

export const PRESET_NAMES = ['recommended', 'security', 'none'] as const
export type PresetName = (typeof PRESET_NAMES)[number]

export interface BuiltinPresetRule {
  level: 'error' | 'warn'
  /** security 预设提升为 error（安全语义） */
  security?: boolean
  note: string
}

/** 1b 内置规则显式启用清单（默认未开；已核对 1.83.0） */
export const BUILTIN_PRESET_RULES: Record<string, BuiltinPresetRule> = {
  'eslint/no-new-func': {
    level: 'error',
    security: true,
    note: 'new Function 动态执行（CWE-95）'
  },
  'eslint/no-throw-literal': {
    level: 'error',
    note: 'throw 字面量丢调用栈'
  },
  'eslint/array-callback-return': {
    level: 'error',
    note: '数组回调漏 return'
  },
  'eslint/no-promise-executor-return': {
    level: 'error',
    note: 'executor 返回值被忽略'
  },
  'eslint/no-fallthrough': {
    level: 'error',
    note: 'switch 贯穿'
  },
  // eslint/no-await-in-loop 不默认启用：corpus 实测 +420 warning（顺序 await 的
  // perf 提示，非安全面，稀释安全信号）→ 待 perf/strict 预设再评估。
  'eslint/no-proto': {
    level: 'error',
    security: true,
    note: '__proto__ 标识符访问'
  },
  'eslint/no-prototype-builtins': {
    level: 'warn',
    security: true,
    note: '直接调用 hasOwnProperty'
  },
  'promise/catch-or-return': {
    level: 'error',
    security: true,
    note: 'promise 链必须 catch/return 终结'
  },
  'unicorn/no-document-cookie': {
    level: 'warn',
    security: true,
    note: 'document.cookie 赋值（与自有 no-insecure-cookie 分工）'
  }
}

/** 按 preset 展开规则表；用户 rules 在 translate 中后置覆盖 */
export function expandPreset(
  name: PresetName,
  entries: RegistryEntry[] = registry
): Record<string, RuleSetting> {
  if (name === 'none') return {}
  const rules: Record<string, RuleSetting> = {}
  for (const entry of entries) {
    if (entry.owner !== 'lintsight-js' || entry.status !== 'active') continue
    const level: RuleSetting =
      name === 'security' && entry.category === 'security'
        ? 'error'
        : entry.defaultSeverity === 'warning'
          ? 'warn' // registry 用 SARIF 口径 'warning'；oxlintrc 只接受 warn
          : 'error'
    rules[entry.ruleId] = level
  }
  for (const [ruleId, def] of Object.entries(BUILTIN_PRESET_RULES)) {
    rules[ruleId] = name === 'security' && def.security ? 'error' : def.level
  }
  return rules
}
