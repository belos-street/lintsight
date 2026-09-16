/** no-cors-wildcard —— P0 安全（v0.1① #12，CWE-942 / OWASP A05）。 */
export default {
  meta: {
    category: 'security',
    severity: 'warning',
    confidence: 'high',
    typeRequirement: 'none',
    tags: ['cwe-942', 'owasp-a05'],
    fixable: undefined,
    messages: {
      corsWildcard:
        'CORS policy allows any origin ("*" / reflect-all): restrict to an explicit origin allowlist. (no-cors-wildcard)'
    },
    docs: {
      description:
        '禁止 CORS 通配来源（Access-Control-Allow-Origin: * 或 cors origin:true）',
      rationale:
        '通配/反射任意来源使跨站请求可携带凭证读取响应，扩大 XSS/CSRF 影响面；应配置显式白名单。',
      badExamples: [
        "res.setHeader('Access-Control-Allow-Origin', '*')",
        'cors({ origin: true })'
      ],
      goodExamples: [
        "res.setHeader('Access-Control-Allow-Origin', 'https://app.example.com')"
      ],
      falsePositives: ['纯公开只读 API 的通配可配 allow']
    }
  },
  create(context) {
    const HEADER = 'access-control-allow-origin'

    return {
      CallExpression(node) {
        const callee = node.callee
        // res.setHeader('Access-Control-Allow-Origin', '*')
        if (
          callee?.type === 'MemberExpression' &&
          callee.property?.type === 'Identifier' &&
          callee.property.name === 'setHeader'
        ) {
          const name = node.arguments?.[0]
          const value = node.arguments?.[1]
          if (
            name?.type === 'Literal' &&
            typeof name.value === 'string' &&
            name.value.toLowerCase() === HEADER
          ) {
            if (value?.type === 'Literal' && value.value === '*') {
              context.report({ node, messageId: 'corsWildcard' })
            }
          }
          return
        }
        // cors({ origin: true | '*' })
        const corsName =
          callee?.type === 'Identifier'
            ? callee.name
            : callee?.type === 'MemberExpression'
              ? callee.property?.name
              : null
        if (corsName === 'cors') {
          const arg0 = node.arguments?.[0]
          if (arg0?.type === 'ObjectExpression') {
            for (const prop of arg0.properties ?? []) {
              const key =
                prop.key?.type === 'Identifier'
                  ? prop.key.name
                  : prop.key?.value
              if (key !== 'origin') continue
              const v = prop.value
              if (
                (v?.type === 'Literal' && v.value === '*') ||
                (v?.type === 'Literal' && v.value === true)
              ) {
                context.report({ node, messageId: 'corsWildcard' })
              }
            }
          }
        }
      },
      Property(node) {
        const key =
          node.key?.type === 'Literal' ? node.key.value : node.key?.name
        if (
          typeof key === 'string' &&
          key.toLowerCase() === HEADER &&
          node.value?.type === 'Literal' &&
          node.value.value === '*'
        ) {
          context.report({ node, messageId: 'corsWildcard' })
        }
      }
    }
  }
}
