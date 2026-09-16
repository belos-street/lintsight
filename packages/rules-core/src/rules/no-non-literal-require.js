/** no-non-literal-require —— P0 安全（v0.1① #6，CWE-94 / OWASP A03）。 */
export default {
  meta: {
    category: 'security',
    severity: 'error',
    confidence: 'high',
    typeRequirement: 'none',
    tags: ['cwe-94', 'owasp-a03'],
    fixable: undefined,
    messages: {
      nonLiteralRequire:
        'Module specifier is not a string literal: dynamic require/import can load arbitrary code. (no-non-literal-require)'
    },
    docs: {
      description: '禁止 require()/import() 的模块说明符为非字面量',
      rationale:
        '动态模块说明符让加载的代码不可审计，攻击者可借路径拼接加载恶意模块；动态装配场景应使用显式映射表。',
      badExamples: ['require(moduleName)', 'await import(specifier)'],
      goodExamples: ["require('node:fs')", "await import('./config.json')"],
      falsePositives: [
        '构建器统计的动态导入（如 import.meta.glob）属构建期面，不在此检测'
      ]
    }
  },
  create(context) {
    function isStatic(node) {
      if (node?.type === 'Literal' && typeof node.value === 'string')
        return true
      if (node?.type === 'TemplateLiteral') return node.expressions.length === 0
      return false
    }

    return {
      CallExpression(node) {
        if (
          node.callee?.type !== 'Identifier' ||
          node.callee.name !== 'require'
        )
          return
        const arg0 = node.arguments?.[0]
        if (arg0 && !isStatic(arg0)) {
          context.report({ node, messageId: 'nonLiteralRequire' })
        }
      },
      ImportExpression(node) {
        if (node.source && !isStatic(node.source)) {
          context.report({ node, messageId: 'nonLiteralRequire' })
        }
      }
    }
  }
}
