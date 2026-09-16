/** no-async-array-method —— P0 正确性（v0.1① #4）。Promise.all 消费 async map 回调豁免。 */
export default {
  meta: {
    category: 'correctness',
    severity: 'error',
    confidence: 'high',
    typeRequirement: 'none',
    tags: [],
    fixable: undefined,
    messages: {
      asyncArrayMethod:
        'Array.prototype.{{method}} does not await async callbacks: the returned Promise is ignored. Use for...of with await, or Promise.all. (no-async-array-method)'
    },
    docs: {
      description: '禁止向 forEach/map/filter/reduce 等数组方法传入 async 回调',
      rationale:
        '数组方法不感知 Promise，async 回调返回的 Promise 被静默丢弃：forEach 的异常不会冒泡、map 的结果不是数据而是 Promise 数组、reduce 的聚合值是 Promise。',
      badExamples: ['ids.forEach(async (id) => { await save(id) })'],
      goodExamples: [
        'for (const id of ids) { await save(id) }',
        'await Promise.all(ids.map((id) => save(id)))'
      ],
      falsePositives: [
        '自定义类实现同名方法且确有 Promise 语义时误报（duck typing 限制，可行内 ignore）'
      ]
    }
  },
  create(context) {
    const METHODS = new Set([
      'forEach',
      'map',
      'filter',
      'reduce',
      'reduceRight',
      'some',
      'every'
    ])
    function consumedByPromiseAll(node) {
      // map 的 async 回调被 Promise.all 消费是标准写法（v0.1① dogfood 误报修正）
      const parent = node.parent
      if (parent?.type !== 'CallExpression') return false
      const pc = parent.callee
      return (
        pc?.type === 'MemberExpression' &&
        pc.object?.type === 'Identifier' &&
        pc.object.name === 'Promise' &&
        pc.property?.name === 'all'
      )
    }
    return {
      CallExpression(node) {
        const callee = node.callee
        if (!callee || callee.type !== 'MemberExpression') return
        if (!callee.property || callee.property.type !== 'Identifier') return
        const method = callee.property.name
        if (!METHODS.has(method)) return
        const cb = node.arguments?.[0]
        if (!cb) return
        if (
          (cb.type === 'ArrowFunctionExpression' ||
            cb.type === 'FunctionExpression') &&
          cb.async &&
          !(method === 'map' && consumedByPromiseAll(node))
        ) {
          context.report({
            node,
            messageId: 'asyncArrayMethod',
            data: { method }
          })
        }
      }
    }
  }
}
