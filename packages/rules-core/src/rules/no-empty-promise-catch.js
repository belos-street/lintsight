/** no-empty-promise-catch —— P0 正确性（v0.1① #9）。 */
export default {
  meta: {
    category: 'correctness',
    severity: 'error',
    confidence: 'high',
    typeRequirement: 'none',
    tags: [],
    fixable: undefined,
    messages: {
      emptyCatchCallback:
        '.catch() handler is empty: the rejection is silently swallowed. Handle the error or rethrow it. (no-empty-promise-catch)'
    },
    docs: {
      description: '禁止 .catch(() => {}) 形式的静默吞错',
      rationale:
        '空 catch 回调与空 catch 块同样危险；与 no-empty-catch 分工：本条管 promise 链的回调面。',
      badExamples: ['fetch(url).catch(() => {})'],
      goodExamples: ['fetch(url).catch((e) => logger.error(e))'],
      falsePositives: [
        '命名处理器（.catch(handleError)）无法证明为空，保守不报'
      ]
    }
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee
        if (
          callee?.type !== 'MemberExpression' ||
          callee.property?.name !== 'catch'
        )
          return
        const cb = node.arguments?.[0]
        if (!cb) return
        const isEmpty =
          (cb.type === 'ArrowFunctionExpression' ||
            cb.type === 'FunctionExpression') &&
          ((cb.body?.type === 'BlockStatement' && cb.body.body.length === 0) ||
            (cb.body?.type === 'Identifier' && cb.body.name === 'undefined'))
        if (isEmpty) {
          context.report({ node, messageId: 'emptyCatchCallback' })
        }
      }
    }
  }
}
