/** no-swallowed-promise-error —— P0 正确性（v0.1① #3，边界见 docs）。 */
export default {
  meta: {
    category: 'correctness',
    severity: 'error',
    confidence: 'medium',
    typeRequirement: 'none',
    tags: [],
    fixable: undefined,
    messages: {
      swallowed:
        'Caught error "{{name}}" is neither referenced nor rethrown: the failure is silently swallowed. (no-swallowed-promise-error)'
    },
    docs: {
      description: '禁止 catch 到错误后既不引用也不重新抛出',
      rationale:
        '吞错是故障排查的第一障碍；至少应记录、上报或原样/包装抛出。与 no-unused-vars(caughtErrors) 分工：内置只管「未使用变量」，本条语义是「吞错」（未引用且无任何处理动作）。',
      badExamples: ['catch (e) { console.error("failed") }'],
      goodExamples: [
        'catch (e) { console.error("failed", e) }',
        'catch (e) { throw e }'
      ],
      falsePositives: [
        '无 binding 的 catch {} 由 no-empty-catch 覆盖（零语句）或属有意忽略',
        '仅记录上下文但确认错误无需处理的场景，可行内 ignore'
      ]
    }
  },
  create(context) {
    function walk(node, match) {
      if (!node || typeof node !== 'object') return false
      if (Array.isArray(node)) return node.some((child) => walk(child, match))
      if (match(node)) return true
      for (const key of Object.keys(node)) {
        if (key === 'parent' || key === 'range' || key === 'loc') continue
        if (walk(node[key], match)) return true
      }
      return false
    }

    return {
      CatchClause(node) {
        // 无 binding 的 catch 不归本条（零语句归 no-empty-catch）
        if (!node.param || node.param.type !== 'Identifier') return
        const name = node.param.name
        const hasReference = walk(
          node.body,
          (n) => n.type === 'Identifier' && n.name === name
        )
        const hasThrow = walk(node.body, (n) => n.type === 'ThrowStatement')
        if (!hasReference && !hasThrow) {
          context.report({ node, messageId: 'swallowed', data: { name } })
        }
      }
    }
  }
}
