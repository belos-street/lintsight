/**
 * 报告器（design-m1 §4.1）：JSON / text / SARIF（M2 T2.5，M3 补强）。
 * JSON 为平台消费面（快照测试锁定）；text 供本地 CLI 阅读；SARIF 2.1.0 供平台对接。
 * 本包零外部依赖（编译单文件分发的重量约束）：SARIF 规则元数据由调用方
 * 以 RuleMeta[] 传入（cli 从 @lintsight/diagnostic 注册表构建），这里只做结构映射。
 */

export interface ReportSummary {
  error: number
  warning: number
  info: number
}

/** SARIF codeFlows/relatedLocations 的证据链事件（结构化本地类型，与
 * @lintsight/diagnostic 的 PathEvent 结构兼容；kind 收窄为 string 保零依赖） */
export interface PathEventLike {
  kind: string
  node: string
  offset: number
  line: number
  column: number
}

export interface ReportLike {
  contractVersion: string
  files: number
  summary: ReportSummary
  diagnostics: {
    file: string
    span: { line: number; column: number }
    severity: string
    ruleId: string
    message: string
    /** M3 契约 v2：引擎 taint 证据链（可选） */
    pathEvents?: PathEventLike[]
    /** M3：SARIF partialFingerprints 消费面（可选） */
    fingerprint?: string
  }[]
}

export function formatJson(report: ReportLike): string {
  return JSON.stringify(report, null, 2)
}

export function formatText(report: ReportLike): string {
  const lines: string[] = []
  for (const d of report.diagnostics) {
    lines.push(
      `${d.file}:${d.span.line}:${d.span.column}  ${d.severity.padEnd(7)}  ${d.ruleId}  ${d.message}`
    )
  }
  if (report.diagnostics.length > 0) lines.push('')
  lines.push(
    `summary: ${report.summary.error} error(s), ${report.summary.warning} warning(s), ${report.summary.info} info, ${report.files} file(s)`
  )
  return lines.join('\n')
}

import { formatSarif, type SarifOptions } from './sarif'
export { formatSarif, type SarifRuleMeta, type SarifOptions } from './sarif'

/** 统一格式器签名：opts 仅 sarif 消费（toolVersion / 规则目录）；json/text 忽略 */
export type FormatterFn = (report: ReportLike, opts?: SarifOptions) => string

export type FormatName = 'json' | 'text' | 'sarif'

export const formatters: Record<FormatName, FormatterFn> = {
  json: formatJson,
  text: formatText,
  sarif: formatSarif
}
