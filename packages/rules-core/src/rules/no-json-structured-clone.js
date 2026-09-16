/** no-json-structured-clone —— P0 正确性（v0.1① #7）。 */
export default {
  meta: {
    category: 'correctness',
    severity: 'warning',
    confidence: 'high',
    typeRequirement: 'none',
    tags: [],
    fixable: undefined,
    messages: {
      structuredClone:
        'JSON.parse(JSON.stringify(...)) silently drops Date, Map, Set, undefined and functions; use structuredClone(). (no-json-structured-clone)'
    },
    docs: {
      description: '禁止用 JSON 序列化做深拷贝',
      rationale:
        'JSON 往返会静默丢失 Date/Map/Set/undefined/函数/循环引用，是常见的数据损坏源；运行环境支持时用 structuredClone()。',
      badExamples: ['const copy = JSON.parse(JSON.stringify(state))'],
      goodExamples: ['const copy = structuredClone(state)'],
      falsePositives: ['确知数据为纯 JSON 可序列化结构时可配 allow: true']
    }
  },
  create(context) {
    function isJsonCall(node, method) {
      return (
        node?.type === 'CallExpression' &&
        node.callee?.type === 'MemberExpression' &&
        node.callee.object?.type === 'Identifier' &&
        node.callee.object.name === 'JSON' &&
        node.callee.property?.name === method
      )
    }

    return {
      CallExpression(node) {
        if (!isJsonCall(node, 'parse')) return
        const arg = node.arguments?.[0]
        if (isJsonCall(arg, 'stringify')) {
          context.report({ node, messageId: 'structuredClone' })
        }
      }
    }
  }
}
