/**
 * @lintsight/rule-sdk —— 规则作者唯一依赖面（铁律 2，rule-sdk RFC v0.1）。
 * defineRule / definePlugin 提供 meta 契约校验（FR-203 缺一拒合，拦截提前到加载期）与类型补全；
 * 产物即 oxlint JS Plugins 可加载的 ESLint v9 兼容对象。禁止在本包类型面出现任何具体 AST 库类型。
 */

export const SDK_VERSION = '0.1.0'

// —— meta 类型（RFC §2.2，FR-203 契约） ——

export type RuleCategory =
  | 'correctness'
  | 'security'
  | 'performance'
  | 'maintainability'
  | 'architecture'
export type RuleSeverity = 'error' | 'warning'
export type RuleConfidence = 'high' | 'medium' | 'low'
export type TypeRequirement = 'none' | 'local' // 'program' 不进 JS 轨道（铁律 3）

export interface RuleDocs {
  description: string
  rationale: string
  badExamples: string[]
  goodExamples: string[]
  /** 强制字段——无误报场景也要显式 [] */
  falsePositives: string[]
}

export interface RuleMeta {
  category: RuleCategory
  severity: RuleSeverity
  confidence: RuleConfidence
  typeRequirement: TypeRequirement
  tags: string[]
  /** messageId → 文案；文案变更视同 breaking（M1-DR2） */
  messages: Record<string, string>
  docs: RuleDocs
  fixable?: 'safe' | 'suggestion' | 'dangerous'
}

// —— 结构化最小节点面（铁律 2：禁止 cast 到具体 AST 类型） ——

export interface RuleNode {
  type: string
  parent?: RuleNode
  range?: [number, number]
  [key: string]: unknown
}

export interface ReportDescriptor {
  node: RuleNode
  /** 必须是 meta.messages 的键（defineRule 运行时校验） */
  messageId: string
  data?: Record<string, string>
  suggest?: unknown // M1.5：随 fix 结构实测（T1.15）启用
}

export interface RuleContext {
  options: unknown
  report(descriptor: ReportDescriptor): void
}

export type Visitor = Record<string, (node: any) => void>

export interface RuleDefinition {
  meta: RuleMeta
  create(ctx: RuleContext): Visitor
}

export type LintsightRule = RuleDefinition

export interface LintsightPlugin {
  name: string
  rules: Record<string, LintsightRule>
}

// —— meta 契约校验 ——

const CATEGORIES = new Set([
  'correctness',
  'security',
  'performance',
  'maintainability',
  'architecture'
])
const SEVERITIES = new Set(['error', 'warning'])
const CONFIDENCES = new Set(['high', 'medium', 'low'])
const TYPE_REQS = new Set(['none', 'local'])

function validateMeta(ruleName: string, meta: RuleMeta): string[] {
  const errors: string[] = []
  const missing = (field: string) =>
    errors.push(`meta.${field} 缺失（FR-203 契约，缺一拒合）`)

  if (!meta || typeof meta !== 'object') return [`[${ruleName}] meta 缺失`]
  if (!CATEGORIES.has(meta.category))
    errors.push(`[${ruleName}] meta.category 非法：'${String(meta.category)}'`)
  if (!SEVERITIES.has(meta.severity))
    errors.push(`[${ruleName}] meta.severity 非法：'${String(meta.severity)}'`)
  if (!CONFIDENCES.has(meta.confidence))
    errors.push(
      `[${ruleName}] meta.confidence 非法：'${String(meta.confidence)}'`
    )
  if (!TYPE_REQS.has(meta.typeRequirement))
    errors.push(
      `[${ruleName}] meta.typeRequirement 非法：'${String(meta.typeRequirement)}'`
    )
  if (!Array.isArray(meta.tags)) missing('tags')
  if (
    !meta.messages ||
    typeof meta.messages !== 'object' ||
    Object.keys(meta.messages).length === 0
  ) {
    missing('messages')
  }
  if (!meta.docs || typeof meta.docs !== 'object') {
    missing('docs')
  } else {
    if (typeof meta.docs.description !== 'string' || !meta.docs.description)
      missing('docs.description')
    if (typeof meta.docs.rationale !== 'string' || !meta.docs.rationale)
      missing('docs.rationale')
    if (!Array.isArray(meta.docs.badExamples)) missing('docs.badExamples')
    if (!Array.isArray(meta.docs.goodExamples)) missing('docs.goodExamples')
    if (!Array.isArray(meta.docs.falsePositives)) missing('docs.falsePositives')
  }
  if (
    meta.category === 'security' &&
    Array.isArray(meta.tags) &&
    meta.tags.every((t) => !t.startsWith('cwe-'))
  ) {
    errors.push(
      `[${ruleName}] security 类规则 tags 必须含 cwe-*（清单评审核定）`
    )
  }
  return errors
}

/** meta 契约校验 + 包装 report 做 messageId 一致性校验（create 时包一次，零重复调用） */
export function defineRule(input: RuleDefinition): LintsightRule {
  if (!input || typeof input.create !== 'function') {
    throw new Error('[rule-sdk] defineRule 需要 { meta, create(ctx) }')
  }
  const errors = validateMeta('(unnamed)', input.meta)
  if (errors.length > 0)
    throw new Error(`[rule-sdk] meta 契约校验失败：\n${errors.join('\n')}`)

  return {
    meta: input.meta,
    create(ctx: RuleContext): Visitor {
      const guarded: RuleContext = {
        options: ctx.options,
        report: (d) => {
          if (!(d.messageId in input.meta.messages)) {
            throw new Error(
              `[rule-sdk] report messageId '${d.messageId}' 不在 meta.messages 中（规则契约）`
            )
          }
          ctx.report(d)
        }
      }
      return input.create(guarded)
    }
  }
}

export function definePlugin(input: LintsightPlugin): LintsightPlugin {
  if (!input?.name || typeof input.name !== 'string') {
    throw new Error('[rule-sdk] definePlugin 需要 { name, rules }')
  }
  if (!input.rules || typeof input.rules !== 'object') {
    throw new Error('[rule-sdk] definePlugin.rules 期望对象')
  }
  for (const [key, rule] of Object.entries(input.rules)) {
    const errors = validateMeta(`${input.name}/${key}`, rule.meta)
    if (errors.length > 0)
      throw new Error(`[rule-sdk] meta 契约校验失败：\n${errors.join('\n')}`)
    if (typeof rule.create !== 'function') {
      throw new Error(`[rule-sdk] ${input.name}/${key}: create(ctx) 必须是函数`)
    }
  }
  return input
}
