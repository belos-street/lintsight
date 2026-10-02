/**
 * @lintsight/diagnostic —— 统一诊断模型、oxlint JSON 归一化、指纹、规则注册表（design-m1 §4.4/§4.6）。
 * contractVersion="1"：字段变更必须递增并以快照测试锁定。
 */

import { getRegistryEntry } from './registry'

export const CONTRACT_VERSION = '1'

// —— oxlint 原始 JSON 形状（`-f json`，oxlint 1.83.0 实测，见 docs/spikes/vertical-slice-m1.md） ——

export interface OxlintSpan {
  /** 字节偏移 */
  offset: number
  length: number
  /** 1-based */
  line: number
  /** 1-based */
  column: number
}

export interface OxlintDiagnostic {
  message: string
  /** 原始 code，如 "eslint(no-debugger)"、"lintsight(no-empty-catch)"；
   * **缺失** = oxc 解析错误或 JS plugin 崩溃（见 normalizeDiagnostics 的细分逻辑） */
  code?: string
  severity: string
  filename: string
  labels: { span: OxlintSpan }[]
  url?: string
  help?: string
}

export interface OxlintJsonOutput {
  diagnostics: OxlintDiagnostic[]
  number_of_files: number
  number_of_rules: number
}

// —— 归一化后的桥接 DTO ——

export interface NormalizedDiagnostic {
  ruleId: string
  severity: string
  message: string
  /** 相对项目根的 POSIX 路径（.vue 已由上层回映射） */
  file: string
  span: OxlintSpan
}

// —— 统一诊断模型（平台消费面） ——

export type Owner = 'oxlint-native' | 'lintsight-js' | 'lintsight-engine'

export interface LintsightDiagnostic {
  contractVersion: string
  ruleId: string
  severity: string
  message: string
  file: string
  span: OxlintSpan
  fingerprint: string
  owner: Owner
}

// —— 归一化 ——

/** "eslint(no-debugger)" → "eslint/no-debugger"；已含 "/" 的原样返回。
 * ⚠️ code 缺失兜底：JS plugin 崩溃时 oxlint 输出无 code 的诊断（实测 "Error running JS plugin"），归一为 internal/oxlint-plugin-error 供下游过滤。 */
export function normalizeRuleId(code: string): string {
  const m = (code ?? '').match(/^([\w-]+)\(([\w-]+)\)$/)
  if (m) return `${m[1]}/${m[2]}`
  return code || 'internal/oxlint-plugin-error'
}

/** 把 filename 归一为相对项目根的 POSIX 路径。
 * 实测（oxlint 1.83.0）：相对输入 → 相对路径；绝对输入 → 去掉开头 '/' 的路径。两种都要兜住。
 * 候选顺序：先试 '/'+filename（还原被剥的绝对路径），再试 root+filename（相对路径）——
 * 顺序反了会让 root+『被剥路径』的拼接产生虚假前缀匹配。 */
export function normalizeFilePath(
  filename: string,
  projectRoot: string
): string {
  const root = projectRoot.endsWith('/')
    ? projectRoot.slice(0, -1)
    : projectRoot
  const candidates = filename.startsWith('/')
    ? [filename]
    : [`/${filename}`, `${root}/${filename}`]
  for (const abs of candidates) {
    if (abs.startsWith(`${root}/`)) return abs.slice(root.length + 1)
  }
  return filename
}

/** M2 type-aware 编排（spike ③ 结论）：tsgolint 对 TS7 已移除的 tsconfig 选项
 * （downlevelIteration/baseUrl/paths 等）输出 typescript(tsconfig-error) error 级诊断，
 * 非用户代码问题且不可阻断——统一降级为 info（不进 exit code）。 */
export const TYPE_AWARE_ERROR_RULE_ID = 'typescript/tsconfig-error'

/** 无 code 诊断细分（corpus 扩容 express/juice-shop 实测）：oxlint JSON 里 code 缺失
 * 有两类——① oxc 解析错误（语法残缺片段 / CJS-ESM 混用，message 为解析器措辞）；
 * ② JS plugin 崩溃（message = "Error running JS plugin"，spike 实测）。两类必须
 * 分开归一：前者是扫描对象自身问题，后者是引擎侧缺陷。 */
export const INTERNAL_PLUGIN_ERROR_RULE_ID = 'internal/oxlint-plugin-error'
export const INTERNAL_PARSE_ERROR_RULE_ID = 'internal/parse-error'

const PLUGIN_ERROR_MARKER = 'Error running JS plugin'

export function normalizeDiagnostics(
  output: OxlintJsonOutput,
  projectRoot: string
): NormalizedDiagnostic[] {
  return output.diagnostics.map((d) => {
    let ruleId: string
    if (d.code) {
      ruleId = normalizeRuleId(d.code)
    } else if (d.message.includes(PLUGIN_ERROR_MARKER)) {
      ruleId = INTERNAL_PLUGIN_ERROR_RULE_ID
    } else {
      ruleId = INTERNAL_PARSE_ERROR_RULE_ID
    }
    return {
      ruleId,
      severity: ruleId === TYPE_AWARE_ERROR_RULE_ID ? 'info' : d.severity,
      message: d.message,
      file: normalizeFilePath(d.filename, projectRoot),
      span: d.labels[0]?.span ?? { offset: 0, length: 0, line: 0, column: 0 }
    }
  })
}

// —— 指纹（M1-DR2） ——

/** M1 指纹 = sha256(ruleId + file + span + message 文本)。
 * 设计口径为 messageId，但 oxlint JSON 无 messageId 字段（spike ④ 实测），
 * 降级为 message 文本参与哈希——规则 messages 文案变更视同 breaking，走显式评审。 */
export function computeFingerprint(d: NormalizedDiagnostic): string {
  const hasher = new Bun.CryptoHasher('sha256')
  hasher.update(
    `${d.ruleId}\u0000${d.file}\u0000${d.span.offset}:${d.span.length}:${d.span.line}:${d.span.column}\u0000${d.message}`
  )
  return hasher.digest('hex')
}

export function deriveOwner(ruleId: string): Owner {
  if (ruleId.startsWith('lintsight/')) return 'lintsight-js'
  if (ruleId.startsWith('lintsight-engine/')) return 'lintsight-engine'
  return 'oxlint-native'
}

// —— 双报消解（M2 T2.5，design-m2 §4.4 归属矩阵） ——

/**
 * 数据流版命中 → 抑制同位置语法级低置信版本。
 * 消解对由注册表 supersedes 字段登记（engine 条目）；位置口径 = 同文件同行
 * （配对 ruleId 语义上同一问题，行级比 span 精确匹配鲁棒——JS 规则与引擎对
 * 同一 fs 调用的锚点 span 不同，实测 db.ts 列号相差 4）。
 * 纯函数：返回过滤后的数组（engine 诊断恒保留）。
 */
export function suppressSuperseded<T extends LintsightDiagnostic>(
  diagnostics: T[]
): T[] {
  // engine 命中位置 → 被抑制的 JS ruleId 集合
  const engineHits = new Map<string, Set<string>>()
  for (const d of diagnostics) {
    const entry = getRegistryEntry(d.ruleId)
    if (entry?.owner !== 'lintsight-engine' || !entry.supersedes?.length)
      continue
    const key = `${d.file}\u0000${d.span.line}`
    const set = engineHits.get(key) ?? new Set<string>()
    for (const t of entry.supersedes) set.add(t)
    engineHits.set(key, set)
  }
  if (engineHits.size === 0) return diagnostics
  return diagnostics.filter((d) => {
    if (deriveOwner(d.ruleId) !== 'lintsight-js') return true
    const set = engineHits.get(`${d.file}\u0000${d.span.line}`)
    return !set?.has(d.ruleId)
  })
}

export function toLintsightDiagnostic(
  d: NormalizedDiagnostic
): LintsightDiagnostic {
  return {
    contractVersion: CONTRACT_VERSION,
    ruleId: d.ruleId,
    severity: d.severity,
    message: d.message,
    file: d.file,
    span: d.span,
    fingerprint: computeFingerprint(d),
    owner: deriveOwner(d.ruleId)
  }
}

// —— 确定性排序（M1-DR4：并行扫描下保证报告与指纹跨运行稳定） ——

export function sortDiagnostics<T extends LintsightDiagnostic>(
  diagnostics: T[]
): T[] {
  return diagnostics.sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.span.offset - b.span.offset ||
      a.ruleId.localeCompare(b.ruleId)
  )
}
