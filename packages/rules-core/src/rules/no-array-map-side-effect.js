/** no-array-map-side-effect —— P0 正确性（v0.1① #6，收窄版：回调有 return 才报）。 */
export default {
  meta: {
    category: 'correctness',
    severity: 'warning',
    confidence: 'medium',
    typeRequirement: 'none',
    tags: [],
    fixable: undefined,
    messages: {
      mapSideEffect:
        'Return value of .map() is discarded: use forEach for side effects, or consume the mapped result. (no-array-map-side-effect)'
    },
    docs: {
      description: '禁止丢弃 map 的返回结果（回调有返回值却被当作语句执行）',
      rationale:
        'map 的契约是「转换并产出新数组」，结果被丢弃说明意图是副作用，应使用 forEach；丢弃有返回值的映射结果多半是漏接 bug。回调漏 return 的场景由映射清单 array-callback-return 覆盖。',
      badExamples: ['users.map((u) => send(u))'],
      goodExamples: [
        'const names = users.map((u) => u.name)',
        'users.forEach((u) => send(u))'
      ],
      falsePositives: [
        '链中后续仍消费 map 结果的中间写法（本条只看语句级丢弃）'
      ]
    }
  },
  create(context) {
    function hasReturnWithArgument(node) {
      if (!node || typeof node !== 'object') return false
      if (Array.isArray(node))
        return node.some((child) => hasReturnWithArgument(child))
      if (node.type === 'ReturnStatement' && node.argument) return true
      for (const key of Object.keys(node)) {
        if (key === 'parent' || key === 'range' || key === 'loc') continue
        if (hasReturnWithArgument(node[key])) return true
      }
      return false
    }

    return {
      ExpressionStatement(node) {
        const expr = node.expression
        if (expr?.type !== 'CallExpression') return
        const callee = expr.callee
        if (
          callee?.type !== 'MemberExpression' ||
          callee.property?.name !== 'map'
        )
          return
        const cb = expr.arguments?.[0]
        if (!cb) return
        const returns =
          cb.type === 'ArrowFunctionExpression' &&
          cb.body?.type !== 'BlockStatement'
            ? true
            : !!cb.body && hasReturnWithArgument(cb.body)
        if (returns) {
          context.report({ node: expr, messageId: 'mapSideEffect' })
        }
      }
    }
  }
}
