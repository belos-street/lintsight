/**
 * 报告器（design-m1 §4.1）：JSON / text。
 * JSON 为平台消费面（快照测试锁定）；text 供本地 CLI 阅读。
 */

export interface ReportSummary {
  error: number
  warning: number
  info: number
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

export const formatters = { json: formatJson, text: formatText }
export type FormatName = keyof typeof formatters
