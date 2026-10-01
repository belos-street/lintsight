/**
 * SARIF 2.1.0 报告器（M2 T2.5，design-m2 §4.4/平台对接）：
 * 平台侧（代码扫描 UI / GitHub code scanning / 自研面板）的通用交换格式。
 * ruleId → results[].ruleId；severity error|warning|info → level error|warning|note。
 * rules 数组 = 诊断中出现的去重规则清单（ruleIndex 索引）。
 * 快照测试锁定 schema（test/sarif.test.ts）。
 */

import type { ReportLike } from './index'

interface SarifResult {
  ruleId: string
  ruleIndex: number
  level: 'error' | 'warning' | 'note'
  message: { text: string }
  locations: {
    physicalLocation: {
      artifactLocation: { uri: string }
      region: { startLine: number; startColumn: number }
    }
  }[]
}

export function formatSarif(report: ReportLike): string {
  const ruleIds = [...new Set(report.diagnostics.map((d) => d.ruleId))].sort()
  const ruleIndex = new Map(ruleIds.map((id, i) => [id, i]))

  const results: SarifResult[] = report.diagnostics.map((d) => ({
    ruleId: d.ruleId,
    ruleIndex: ruleIndex.get(d.ruleId)!,
    level:
      d.severity === 'error'
        ? 'error'
        : d.severity === 'warning'
          ? 'warning'
          : 'note',
    message: { text: d.message },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: d.file },
          region: { startLine: d.span.line, startColumn: d.span.column }
        }
      }
    ]
  }))

  const sarif = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'lintsight',
            informationUri: 'https://github.com/lintsight/lintsight',
            rules: ruleIds.map((id) => ({ id }))
          }
        },
        results
      }
    ]
  }
  return JSON.stringify(sarif, null, 2)
}
