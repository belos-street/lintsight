/**
 * 内置启用映射清单 v0（design-m1 §4.2 / M1-DR7）。
 * 声明「oxlint 内置规则/类别 → lintsight 默认启用集」，config-bridge 据此合成 .oxlintrc 的规则段。
 * M1 默认集 = correctness 基线；nursery 永不默认开（配置语义随 patch 漂移，破坏确定性）。
 * P0 规则清单评审（T1.0b）后在此扩充显式启用项。
 */

export interface BuiltinMapping {
  categories: Record<string, 'allow' | 'error' | 'warn'>
  /** 显式启用的内置规则（内置名，无命名空间），值为 oxlint 规则配置 */
  rules: Record<
    string,
    'allow' | 'error' | 'warn' | ['error' | 'warn', Record<string, unknown>]
  >
  ignorePatterns: string[]
}

export const builtinMapping: BuiltinMapping = {
  categories: { correctness: 'error' },
  rules: {},
  ignorePatterns: []
}
