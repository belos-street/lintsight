/**
 * SARIF 2.1.0 报告器（M2 T2.5，M3 补强；design-m2 §4.4/平台对接）：
 * 平台侧（代码扫描 UI / GitHub code scanning / 自研面板）的通用交换格式。
 * ruleId → results[].ruleId；severity error|warning|info → level error|warning|note。
 *
 * M3 补强（消费面验收）：
 * - driver.version/semanticVersion ← opts.toolVersion（cli 传 pkg.version；缺省省略）
 * - rules[] 增强元数据（name/shortDescription/defaultConfiguration/helpUri）——
 *   元数据源 = @lintsight/diagnostic 注册表，由 cli 构建为 SarifRuleMeta[] 传入
 *   （本包零依赖铁律）；无条目的 oxlint-native 规则仅 id+name 兜底
 * - results[].partialFingerprints.lintsightFingerprintV1 ← 诊断指纹（平台侧稳定锚点）
 * - pathEvents → codeFlows（threadFlows[0].locations 按序 executionOrder）+ relatedLocations 双写；
 *   不写 kind 枚举字段（防 SARIF schema 违规），语义进 message.text
 * 快照测试锁定 schema（test/sarif.test.ts）。
 */

import type { PathEventLike, ReportLike } from './index'

export interface SarifRuleMeta {
  id: string
  name?: string
  shortDescription?: string
  defaultLevel?: 'error' | 'warning' | 'note'
  helpUri?: string
}

export interface SarifOptions {
  /** 工具版本（driver.version + semanticVersion）；缺省省略两字段 */
  toolVersion?: string
  /** 规则目录（registry 来源）；缺省时 rules[] 仅 id+name 兜底 */
  rules?: SarifRuleMeta[]
}

interface SarifLocation {
  physicalLocation: {
    artifactLocation: { uri: string }
    region: { startLine: number; startColumn: number }
  }
  message?: { text: string }
}

interface SarifResult {
  ruleId: string
  ruleIndex: number
  level: 'error' | 'warning' | 'note'
  message: { text: string }
  locations: SarifLocation[]
  relatedLocations?: SarifLocation[]
  codeFlows?: {
    threadFlows: {
      locations: { executionOrder: number; location: SarifLocation }[]
    }[]
  }[]
  partialFingerprints?: Record<string, string>
}

function toLevel(severity: string): 'error' | 'warning' | 'note' {
  return severity === 'error'
    ? 'error'
    : severity === 'warning'
      ? 'warning'
      : 'note'
}

/** 证据链事件 → SARIF location（message 承载 kind 语义，不落 schema 外字段） */
function eventLocation(file: string, ev: PathEventLike): SarifLocation {
  return {
    physicalLocation: {
      artifactLocation: { uri: file },
      region: { startLine: ev.line, startColumn: ev.column }
    },
    message: { text: `${ev.kind}: ${ev.node}` }
  }
}

export function formatSarif(
  report: ReportLike,
  opts: SarifOptions = {}
): string {
  const ruleIds = [...new Set(report.diagnostics.map((d) => d.ruleId))].sort()
  const ruleIndex = new Map(ruleIds.map((id, i) => [id, i]))
  const metaById = new Map((opts.rules ?? []).map((m) => [m.id, m]))

  const results: SarifResult[] = report.diagnostics.map((d) => {
    const location: SarifLocation = {
      physicalLocation: {
        artifactLocation: { uri: d.file },
        region: { startLine: d.span.line, startColumn: d.span.column }
      }
    }
    const events = d.pathEvents ?? []
    return {
      ruleId: d.ruleId,
      ruleIndex: ruleIndex.get(d.ruleId)!,
      level: toLevel(d.severity),
      message: { text: d.message },
      locations: [location],
      // 证据链双写：codeFlows（平台 taint 路径可视化）+ relatedLocations（UI 侧跳转锚点）
      ...(events.length > 0
        ? {
            codeFlows: [
              {
                threadFlows: [
                  {
                    locations: events.map((ev, i) => ({
                      // threadFlowLocation 规范序号属性（schema 外禁 step）
                      executionOrder: i + 1,
                      location: eventLocation(d.file, ev)
                    }))
                  }
                ]
              }
            ],
            relatedLocations: events.map((ev) => eventLocation(d.file, ev))
          }
        : {}),
      ...(d.fingerprint
        ? {
            partialFingerprints: {
              lintsightFingerprintV1: d.fingerprint
            }
          }
        : {})
    }
  })

  const sarif = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'lintsight',
            informationUri: 'https://github.com/belos-street/lintsight',
            ...(opts.toolVersion
              ? {
                  version: opts.toolVersion,
                  semanticVersion: opts.toolVersion
                }
              : {}),
            rules: ruleIds.map((id) => {
              const meta = metaById.get(id)
              return {
                id,
                // 末段名称兜底（"lintsight/no-x" → "no-x"），无目录也有可读 name
                name: meta?.name ?? id.split('/').pop()!,
                ...(meta?.shortDescription
                  ? { shortDescription: { text: meta.shortDescription } }
                  : {}),
                ...(meta?.defaultLevel
                  ? {
                      defaultConfiguration: {
                        level: meta.defaultLevel
                      }
                    }
                  : {}),
                ...(meta?.helpUri ? { helpUri: meta.helpUri } : {})
              }
            })
          }
        },
        results
      }
    ]
  }
  return JSON.stringify(sarif, null, 2)
}
