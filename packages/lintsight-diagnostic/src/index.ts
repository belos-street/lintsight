/**
 * @lintsight/diagnostic —— 统一诊断模型、oxlint JSON 归一化、指纹、规则注册表（design-m1 §4.4/§4.6）。
 * contractVersion="1"：字段变更必须递增并以快照测试锁定。
 */

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
  /** 原始 code，如 "eslint(no-debugger)"、"lintsight(no-empty-catch)" */
  code: string
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

export type Owner = 'oxlint-native' | 'lintsight-js'

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

/** "eslint(no-debugger)" → "eslint/no-debugger"；已含 "/" 的原样返回 */
export function normalizeRuleId(code: string): string {
  const m = code.match(/^([\w-]+)\(([\w-]+)\)$/)
  return m ? `${m[1]}/${m[2]}` : code
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

export function normalizeDiagnostics(
  output: OxlintJsonOutput,
  projectRoot: string
): NormalizedDiagnostic[] {
  return output.diagnostics.map((d) => ({
    ruleId: normalizeRuleId(d.code),
    severity: d.severity,
    message: d.message,
    file: normalizeFilePath(d.filename, projectRoot),
    span: d.labels[0]?.span ?? { offset: 0, length: 0, line: 0, column: 0 }
  }))
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
  return ruleId.startsWith('lintsight/') ? 'lintsight-js' : 'oxlint-native'
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
