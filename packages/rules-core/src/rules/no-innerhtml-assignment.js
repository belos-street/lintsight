/** no-innerhtml-assignment —— P0 安全（v0.1① #10，CWE-79 / OWASP A03，◆ M2 taint 接管，单 severity）。 */
export default {
  meta: {
    category: 'security',
    severity: 'error',
    confidence: 'medium',
    typeRequirement: 'none',
    tags: ['cwe-79', 'owasp-a03'],
    fixable: undefined,
    messages: {
      htmlSink:
        'Assigning non-literal content to "{{sink}}" enables XSS; sanitize the input or use textContent. (no-innerhtml-assignment)'
    },
    docs: {
      description: '禁止向 innerHTML/outerHTML/document.write 写入非字面量内容',
      rationale:
        '动态 HTML 注入是 XSS 主入口；纯字面量是静态内容不触发（单 severity，降噪走 allow/ignore）。数据流级检测由 M2 taint 接管（◆）。',
      badExamples: ['el.innerHTML = userInput', 'document.write(userContent)'],
      goodExamples: [
        "el.innerHTML = '<b>static</b>'",
        'el.textContent = userInput'
      ],
      falsePositives: [
        '右值已过 DOMPurify 等净化器的场景（taint 版可识别 sanitizer）'
      ]
    }
  },
  create(context) {
    function isStaticHtml(node) {
      if (node?.type === 'Literal' && typeof node.value === 'string')
        return true
      if (node?.type === 'TemplateLiteral') return node.expressions.length === 0
      return false
    }
    const SINKS = new Set(['innerHTML', 'outerHTML'])

    return {
      AssignmentExpression(node) {
        const target = node.left
        if (
          target?.type === 'MemberExpression' &&
          target.property?.type === 'Identifier' &&
          SINKS.has(target.property.name)
        ) {
          if (!isStaticHtml(node.right)) {
            context.report({
              node,
              messageId: 'htmlSink',
              data: { sink: target.property.name }
            })
          }
        }
      },
      CallExpression(node) {
        const callee = node.callee
        if (
          callee?.type === 'MemberExpression' &&
          callee.object?.type === 'Identifier' &&
          callee.object.name === 'document' &&
          callee.property?.type === 'Identifier' &&
          (callee.property.name === 'write' ||
            callee.property.name === 'writeln')
        ) {
          const arg0 = node.arguments?.[0]
          if (arg0 && !isStaticHtml(arg0)) {
            context.report({
              node,
              messageId: 'htmlSink',
              data: { sink: `document.${callee.property.name}` }
            })
          }
        }
      }
    }
  }
}
