/**
 * lintsight 自有规则集（JS 轨道，oxlint JS Plugins · alpha）。
 * 运行在 oxlint 嵌入式 JS runtime —— 本文件禁止使用 Bun/Node API。
 */
export default {
  name: 'lintsight',
  meta: { name: 'lintsight' },
  rules: {
    'no-empty-catch': {
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
            'Unexpected empty catch block. Handle the error or rethrow it.'
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
  }
}
