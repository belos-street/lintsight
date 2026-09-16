/** no-ignored-reduce-result —— P0 正确性（v0.1① #8）。 */
export default {
  meta: {
    category: 'correctness',
    severity: 'error',
    confidence: 'high',
    typeRequirement: 'none',
    tags: [],
    fixable: undefined,
    messages: {
      ignoredReduce:
        'Return value of .reduce() is discarded: the aggregation result is lost. (no-ignored-reduce-result)'
    },
    docs: {
      description: '禁止丢弃 reduce/reduceRight 的聚合结果',
      rationale:
        'reduce 的契约是聚合产出；结果被丢弃说明遍历目的与写法不符，聚合逻辑多半白做。',
      badExamples: ['items.reduce((acc, n) => acc + n, 0)'],
      goodExamples: ['const total = items.reduce((acc, n) => acc + n, 0)'],
      falsePositives: ['无']
    }
  },
  create(context) {
    return {
      ExpressionStatement(node) {
        const expr = node.expression
        if (expr?.type !== 'CallExpression') return
        const prop = expr.callee?.property
        if (
          prop?.type === 'Identifier' &&
          (prop.name === 'reduce' || prop.name === 'reduceRight')
        ) {
          context.report({ node: expr, messageId: 'ignoredReduce' })
        }
      }
    }
  }
}
