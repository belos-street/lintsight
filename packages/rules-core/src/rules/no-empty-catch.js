/**
 * no-empty-catch —— P0 正确性（已上线首条）。
 * 与 no-swallowed-promise-error 分工：本条管 catch 块「零语句」；与 no-empty-promise-catch 分工：那条管 promise 链回调面。
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
        '注释占位的 catch 也会告警（零语句即触发）——正式版可增加 allowComments 选项'
      ]
    }
  },
  create(context) {
    return {
      CatchClause(node) {
        const statements = node.body?.body ?? []
        if (statements.length === 0) {
          context.report({ node, messageId: 'emptyCatch' })
        }
      }
    }
  }
}
