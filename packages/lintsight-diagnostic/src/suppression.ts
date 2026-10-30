/**
 * 行内抑制（契约 v3 / G2）：`// lintsight-ignore-next-line <ruleId>: <reason>`
 *
 * 语义：
 *   - 仅行注释；作用于**下一行**（诊断 span.line = 指令行 + 1）；
 *   - reason 必填（进审计字段与 SARIF suppressions.justification）；
 *   - ruleId 精确匹配；同文件多指令各自独立；
 *   - 非法指令（缺 ruleId / 缺 reason / 同一行重复）只记录 invalid，不抑制、不中断。
 *
 * 解析是纯函数；文件读取与日志由 pipeline 负责（保持本包无 IO）。
 */
import type { LintsightDiagnostic, Suppression } from './index'

export interface InlineSuppressionDirective {
  ruleId: string
  reason: string
  /** 指令所在行（1-based） */
  line: number
}

export type SuppressionIssueCode =
  | 'missing-rule'
  | 'missing-reason'
  | 'duplicate'

export interface SuppressionIssue {
  /** 指令所在行（1-based） */
  line: number
  code: SuppressionIssueCode
  raw: string
}

export interface FileSuppressions {
  directives: InlineSuppressionDirective[]
  invalid: SuppressionIssue[]
}

export interface AppliedSuppressions<T extends LintsightDiagnostic> {
  diagnostics: T[]
  suppressed: number
  /** file → 非法指令（pipeline 侧 warn） */
  invalid: { file: string; line: number; code: SuppressionIssueCode }[]
}

const PREFIX = 'lintsight-ignore-next-line'
const DIRECTIVE_RE =
  /^\s*\/\/\s*lintsight-ignore-next-line\s+([^\s:]+)\s*:\s*(.*)$/

export function parseInlineSuppressions(content: string): FileSuppressions {
  const directives: InlineSuppressionDirective[] = []
  const invalid: SuppressionIssue[] = []
  const seen = new Set<string>()
  const lines = content.split(/\r?\n/)

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    if (!raw.includes(PREFIX)) continue
    const line = i + 1
    const m = raw.match(DIRECTIVE_RE)
    if (!m) {
      invalid.push({ line, code: 'missing-rule', raw })
      continue
    }
    const reason = m[2].trim()
    if (!reason) {
      invalid.push({ line, code: 'missing-reason', raw })
      continue
    }
    const key = `${line}\u0000${m[1]}`
    if (seen.has(key)) {
      invalid.push({ line, code: 'duplicate', raw })
      continue
    }
    seen.add(key)
    directives.push({ ruleId: m[1], reason, line })
  }
  return { directives, invalid }
}

/** 把抑制指令应用到诊断：命中者加 suppression 审计字段，仍保留在返回数组 */
export function applySuppressions<T extends LintsightDiagnostic>(
  diagnostics: T[],
  byFile: ReadonlyMap<string, FileSuppressions>
): AppliedSuppressions<T> {
  let suppressed = 0
  const invalid: AppliedSuppressions<T>['invalid'] = []
  for (const [file, s] of byFile) {
    for (const issue of s.invalid) {
      invalid.push({ file, line: issue.line, code: issue.code })
    }
  }

  const out = diagnostics.map((d) => {
    const s = byFile.get(d.file)
    if (!s || s.directives.length === 0) return d
    const directive = s.directives.find(
      (x) => x.ruleId === d.ruleId && x.line === d.span.line - 1
    )
    if (!directive) return d
    suppressed++
    const suppression: Suppression = {
      kind: 'inSource',
      justification: directive.reason,
      directiveLine: directive.line
    }
    return { ...d, suppression }
  })

  return { diagnostics: out, suppressed, invalid }
}
