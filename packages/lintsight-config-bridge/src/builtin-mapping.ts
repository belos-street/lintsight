/**
 * 内置启用映射清单 v0（design-m1 §4.2 / M1-DR7）。
 * 声明「oxlint 内置规则/类别 → lintsight 默认启用集」，config-bridge 据此合成 .oxlintrc 的规则段。
 * M1 默认集 = correctness 基线；nursery 永不默认开（配置语义随 patch 漂移，破坏确定性）。
 * P0 规则清单评审（T1.0b）后在此扩充显式启用项。
 *
 * ⚠️ ignorePatterns 语义（B2 修复后）：
 * 此清单是「内置默认忽略模式」，**由 CLI pipeline 侧匹配执行**，不再写入 .oxlintrc——
 * oxlint 的 ignorePatterns 严格相对「配置文件所在目录」解析（实测报错原文：
 * "patterns are resolved within the config file's directory"），而 lintsight 生成的
 * oxlintrc 位于 .lintsight-cache/（比项目根深一层），任何「项目根相对」模式都不可达，
 * 且 `..` 会被直接拒绝 → 放进 .oxlintrc 属死配置兼配置解析失败风险。
 * 目录名形态的忽略（node_modules/dist/… ）由 pipeline 的 IGNORED_DIRS 段匹配承担。
 */

export interface BuiltinMapping {
  categories: Record<string, 'allow' | 'error' | 'warn'>
  /** 显式启用的内置规则（内置名，无命名空间），值为 oxlint 规则配置 */
  rules: Record<
    string,
    'allow' | 'error' | 'warn' | ['error' | 'warn', Record<string, unknown>]
  >
  /** 内置默认忽略模式（文件名/路径 glob，pipeline 侧匹配；见文件头 ignorePatterns 语义） */
  ignorePatterns: string[]
}

export const builtinMapping: BuiltinMapping = {
  categories: { correctness: 'error' },
  rules: {},
  // 常见构建产物文件名形态（B2）：压缩/打包产物对源码级 SAST 无有效信号，
  // 且会以数十倍量级稀释报告信噪比。项目特有产物（如 docs/assets/）走用户 ignore。
  ignorePatterns: [
    '**/*.min.js',
    '**/*.min.mjs',
    '**/*.min.cjs',
    '**/*.bundle.js',
    '**/*.bundle.mjs',
    '**/*.chunk.js'
  ]
}
