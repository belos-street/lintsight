/**
 * no-empty-catch —— P0 正确性（已上线首条）。
 * 与 no-swallowed-promise-error 分工：本条管 catch 块「零语句」；与 no-empty-promise-catch 分工：那条管 promise 链回调面。
 * 选项（T1.13）：allowComments=true 时，catch 内含注释占位则放行（默认关闭，行为与 ESLint no-empty 对齐）。
 */
export default {
  meta: {
    // —— FR-203 meta 完备性契约 ——
    category: 'correctness',
    severity: 'error',
    confidence: 'high',
    typeRequirement: 'none',
    tags: [],
    fixable: undefined,
    schema: [
      {
        type: 'object',
        properties: { allowComments: { type: 'boolean' } },
        additionalProperties: false
      }
    ],
    messages: {
      emptyCatch:
        'Unexpected empty catch block. Handle the error or rethrow it. (no-empty-catch)'
    },
    docs: {
      description: '禁止空的 catch 块',
      rationale:
        '空 catch 会静默吞掉错误，掩盖线上故障的根因；应处理、记录或重新抛出。',
      badExamples: ['try { risky(); } catch (e) {}'],
      goodExamples: [
        'try { risky(); } catch (e) { logger.error(e); throw e; }'
      ],
      falsePositives: [
        '注释占位的 catch 默认仍告警（零语句即触发）；allowComments 选项可放行，默认关闭'
      ]
    }
  },
  create(context) {
    // context.options 兼容 ESLint 形态（数组）；oxlint 嵌入式 runtime 实测同构
    const opts = Array.isArray(context.options)
      ? (context.options[0] ?? {})
      : (context.options ?? {})
    const allowComments = opts.allowComments === true
    return {
      CatchClause(node) {
        const statements = node.body?.body ?? []
        if (statements.length === 0) {
          if (allowComments) {
            const comments = context.sourceCode?.getCommentsInside?.(node) ?? []
            if (comments.length > 0) return // 注释占位 = 显式的"有意忽略"，放行
          }
          context.report({ node, messageId: 'emptyCatch' })
        }
      }
    }
  }
}
