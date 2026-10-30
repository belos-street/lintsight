/**
 * T2.5 SARIF 2.1.0 报告器测试：schema 结构锁定（平台对接契约）。
 * level 映射 error→error / warning→warning / info→note；rules 数组去重排序。
 * M3 补强：toolVersion / rules 元数据 / partialFingerprints / codeFlows + relatedLocations。
 */
import { describe, expect, test } from 'bun:test'
import { formatSarif, type SarifRuleMeta } from '../src/sarif'

const report = {
  contractVersion: '2',
  files: 2,
  summary: { error: 1, warning: 1, info: 1 },
  diagnostics: [
    {
      contractVersion: '2',
      ruleId: 'lintsight-engine/no-path-traversal',
      severity: 'error',
      message:
        'Untrusted filename from fs.readdirSync reaches fs.readFileSync.',
      file: 'src/lib/db.ts',
      span: { offset: 4791, length: 34, line: 159, column: 33 },
      fingerprint: 'f'.repeat(64),
      owner: 'lintsight-engine' as const,
      pathEvents: [
        {
          kind: 'source',
          node: 'fs.readdirSync',
          offset: 4700,
          line: 155,
          column: 21
        },
        {
          kind: 'sink',
          node: 'fs.readFileSync',
          offset: 4791,
          line: 159,
          column: 33
        }
      ]
    },
    {
      contractVersion: '2',
      ruleId: 'lintsight/no-sync-io-in-async',
      severity: 'warning',
      message: 'sync io in async',
      file: 'src/a.ts',
      span: { offset: 10, length: 5, line: 3, column: 3 },
      fingerprint: 'e'.repeat(64),
      owner: 'lintsight-js' as const
    },
    {
      contractVersion: '2',
      ruleId: 'typescript/tsconfig-error',
      severity: 'info',
      message: "Option 'baseUrl' is deprecated.",
      file: 'src/a.ts',
      span: { offset: 0, length: 4, line: 1, column: 1 },
      fingerprint: 'd'.repeat(64),
      owner: 'oxlint-native' as const
    }
  ]
}

const v3Report = {
  contractVersion: '3',
  toolVersion: '0.0.1',
  engineStatus: 'ok',
  files: 2,
  summary: { error: 1, warning: 1, info: 0, suppressed: 1 },
  diagnostics: [
    {
      file: 'a.ts',
      span: { line: 2, column: 1 },
      severity: 'error',
      ruleId: 'lintsight/no-sql-concat',
      message: 'SQL injection via concat',
      confidence: 'high',
      cweTags: ['cwe-89'],
      suppression: {
        kind: 'inSource',
        justification: '旧代码兼容',
        directiveLine: 1
      },
      fingerprint: 'a'.repeat(64)
    },
    {
      file: 'b.ts',
      span: { line: 1, column: 1 },
      severity: 'warning',
      ruleId: 'lintsight/no-innerhtml-assignment',
      message: 'innerHTML sink',
      confidence: 'medium',
      cweTags: ['cwe-79'],
      fingerprint: 'b'.repeat(64)
    }
  ]
}

describe('formatSarif v3（契约 v3：CWE / confidence / suppressions）', () => {
  const sarif = JSON.parse(
    formatSarif(v3Report, {
      toolVersion: '0.0.1',
      rules: [
        {
          id: 'lintsight/no-sql-concat',
          name: 'no-sql-concat',
          cweTags: ['cwe-89']
        }
      ]
    })
  )
  const result = sarif.runs[0].results[0]

  test('taxonomies：只收录报告出现的 CWE，排序去重', () => {
    expect(sarif.runs[0].taxonomies).toHaveLength(1)
    expect(sarif.runs[0].taxonomies[0].name).toBe('CWE')
    expect(
      sarif.runs[0].taxonomies[0].taxa.map((t: { id: string }) => t.id)
    ).toEqual(['CWE-79', 'CWE-89'])
  })

  test('results[].taxa / properties.confidence / suppressions', () => {
    expect(result.taxa).toEqual([
      { id: 'CWE-89', index: 1, toolComponent: { name: 'CWE' } }
    ])
    expect(result.properties).toEqual({ confidence: 'high' })
    expect(result.suppressions).toEqual([
      {
        kind: 'inSource',
        justification: '旧代码兼容',
        properties: { directiveLine: 1 }
      }
    ])
  })

  test('rules[].properties.cweTags + driver.version 同源 toolVersion', () => {
    expect(sarif.runs[0].tool.driver.version).toBe('0.0.1')
    const rule = sarif.runs[0].tool.driver.rules.find(
      (r: { id: string }) => r.id === 'lintsight/no-sql-concat'
    )
    expect(rule.properties).toEqual({ cweTags: ['cwe-89'] })
  })

  test('无 CWE 的报告不输出 taxonomies（保持快照干净）', () => {
    const plain = JSON.parse(formatSarif(report))
    expect(plain.runs[0].taxonomies).toBeUndefined()
  })
})

describe('formatSarif（SARIF 2.1.0）', () => {
  const sarif = JSON.parse(formatSarif(report))

  test('顶层结构：$schema / version / runs[0].tool.driver', () => {
    expect(sarif.$schema).toBe('https://json.schemastore.org/sarif-2.1.0.json')
    expect(sarif.version).toBe('2.1.0')
    expect(sarif.runs).toHaveLength(1)
    expect(sarif.runs[0].tool.driver.name).toBe('lintsight')
    // rules 去重且确定性排序（含跨 owner 规则）
    expect(
      sarif.runs[0].tool.driver.rules.map((r: { id: string }) => r.id)
    ).toEqual([
      'lintsight-engine/no-path-traversal',
      'lintsight/no-sync-io-in-async',
      'typescript/tsconfig-error'
    ])
  })

  test('results：ruleIndex / level 映射 / 物理位置', () => {
    const results = sarif.runs[0].results
    expect(results).toHaveLength(3)
    expect(results[0].ruleId).toBe('lintsight-engine/no-path-traversal')
    expect(results[0].ruleIndex).toBe(0)
    expect(results[0].level).toBe('error')
    expect(results[0].message.text).toContain('readdirSync')
    expect(results[0].locations[0].physicalLocation).toEqual({
      artifactLocation: { uri: 'src/lib/db.ts' },
      region: { startLine: 159, startColumn: 33 }
    })
    expect(results[1].level).toBe('warning')
    // type-aware 降级诊断 → SARIF note
    expect(results[2].ruleId).toBe('typescript/tsconfig-error')
    expect(results[2].level).toBe('note')
  })

  test('M3：toolVersion 缺省不写 version/semanticVersion', () => {
    expect(sarif.runs[0].tool.driver.version).toBeUndefined()
    expect(sarif.runs[0].tool.driver.semanticVersion).toBeUndefined()
  })

  test('M3：partialFingerprints.lintsightFingerprintV1 ← 诊断指纹', () => {
    const results = sarif.runs[0].results
    expect(results[0].partialFingerprints).toEqual({
      lintsightFingerprintV1: 'f'.repeat(64)
    })
    expect(results[1].partialFingerprints.lintsightFingerprintV1).toBe(
      'e'.repeat(64)
    )
  })

  test('M3：region 0 值兜底夹取 ≥1（schema minimum: 1）', () => {
    // 无 labels 诊断归一化兜底 {line:0,column:0}——落笔 SARIF 前夹取，防非法报告
    const zeroReport = {
      ...report,
      diagnostics: [
        {
          ...report.diagnostics[1],
          span: { offset: 0, length: 0, line: 0, column: 0 },
          pathEvents: [
            { kind: 'source', node: 'x', offset: 0, line: 0, column: 0 }
          ]
        }
      ]
    }
    const out = JSON.parse(formatSarif(zeroReport))
    const r = out.runs[0].results[0]
    expect(r.locations[0].physicalLocation.region).toEqual({
      startLine: 1,
      startColumn: 1
    })
    // 证据链事件位置同夹取（threadFlowLocation + relatedLocations 双写面）
    expect(
      r.codeFlows[0].threadFlows[0].locations[0].location.physicalLocation
        .region
    ).toEqual({ startLine: 1, startColumn: 1 })
    expect(r.relatedLocations[0].physicalLocation.region).toEqual({
      startLine: 1,
      startColumn: 1
    })
  })

  test('M3：pathEvents → codeFlows（executionOrder 序）+ relatedLocations 双写，不落 kind 枚举字段', () => {
    const taint = sarif.runs[0].results[0]
    const threadLocations = taint.codeFlows[0].threadFlows[0].locations
    expect(threadLocations).toHaveLength(2)
    expect(threadLocations[0].executionOrder).toBe(1)
    expect(threadLocations[0].location.message.text).toBe(
      'source: fs.readdirSync'
    )
    expect(threadLocations[0].location.physicalLocation.region).toEqual({
      startLine: 155,
      startColumn: 21
    })
    expect(threadLocations[1].executionOrder).toBe(2)
    expect(threadLocations[1].location.message.text).toBe(
      'sink: fs.readFileSync'
    )
    expect(taint.relatedLocations).toHaveLength(2)
    expect(taint.relatedLocations[1].message.text).toBe('sink: fs.readFileSync')
    // kind 语义只进 message.text，location 上不出现 schema 外字段
    expect(taint.relatedLocations[0].kind).toBeUndefined()
    // 无证据链的诊断不带 codeFlows/relatedLocations
    expect(sarif.runs[0].results[1].codeFlows).toBeUndefined()
    expect(sarif.runs[0].results[1].relatedLocations).toBeUndefined()
  })

  test('M3：无规则目录回退 — rules[] 仅 id+name（name = 末段）', () => {
    const rules = sarif.runs[0].tool.driver.rules
    expect(rules[0]).toEqual({
      id: 'lintsight-engine/no-path-traversal',
      name: 'no-path-traversal'
    })
  })

  test('M3：规则目录传入 → shortDescription / defaultConfiguration / helpUri', () => {
    const ruleMeta: SarifRuleMeta[] = [
      {
        id: 'lintsight-engine/no-path-traversal',
        name: 'no-path-traversal',
        shortDescription: '外部可控文件名未消毒抵达 fs 读写（CWE-22）',
        defaultLevel: 'error',
        helpUri: 'https://github.com/belos-street/lintsight#规则面'
      },
      {
        id: 'typescript/tsconfig-error',
        shortDescription: 'tsconfig 诊断（type-aware 编排降级为 info）',
        defaultLevel: 'note'
      }
    ]
    const out = JSON.parse(formatSarif(report, { rules: ruleMeta }))
    const rules = out.runs[0].tool.driver.rules
    expect(rules[0]).toEqual({
      id: 'lintsight-engine/no-path-traversal',
      name: 'no-path-traversal',
      shortDescription: { text: '外部可控文件名未消毒抵达 fs 读写（CWE-22）' },
      defaultConfiguration: { level: 'error' },
      helpUri: 'https://github.com/belos-street/lintsight#规则面'
    })
    // 无 helpUri（oxlint-native）→ 不写该字段
    expect(rules[2].id).toBe('typescript/tsconfig-error')
    expect(rules[2].helpUri).toBeUndefined()
    expect(rules[2].defaultConfiguration).toEqual({ level: 'note' })
  })

  test('M3：toolVersion → driver.version + semanticVersion', () => {
    const out = JSON.parse(formatSarif(report, { toolVersion: '0.3.0' }))
    expect(out.runs[0].tool.driver.version).toBe('0.3.0')
    expect(out.runs[0].tool.driver.semanticVersion).toBe('0.3.0')
  })
})
