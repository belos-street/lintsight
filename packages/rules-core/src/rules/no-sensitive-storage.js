/** no-sensitive-storage —— P0 安全（v0.1① #9，CWE-312 / OWASP A02）。 */
export default {
  meta: {
    category: 'security',
    severity: 'error',
    confidence: 'medium',
    typeRequirement: 'none',
    tags: ['cwe-312', 'owasp-a02'],
    fixable: undefined,
    messages: {
      sensitiveStorage:
        'Storing sensitive data ("{{key}}") in Web Storage exposes it to XSS; use HttpOnly cookies. (no-sensitive-storage)'
    },
    docs: {
      description: '禁止向 localStorage/sessionStorage 写入凭证命名键',
      rationale:
        'Web Storage 可被任意同源脚本读取，XSS 一次即全丢；凭证应走 HttpOnly Cookie。',
      badExamples: ["localStorage.setItem('token', jwt)"],
      goodExamples: ['localStorage.setItem("ui-theme", theme)'],
      falsePositives: [
        '非凭证语义的同名键（如 tokenType）可改命名或行内 ignore'
      ]
    }
  },
  create(context) {
    const SENSITIVE_KEY =
      /(token|secret|jwt|credential|password|passwd|refresh[_-]?token)/i

    return {
      CallExpression(node) {
        const callee = node.callee
        if (
          callee?.type !== 'MemberExpression' ||
          callee.property?.name !== 'setItem'
        )
          return
        const obj = callee.object
        if (
          obj?.type !== 'Identifier' ||
          !/^(local|session)Storage$/.test(obj.name)
        )
          return
        const keyArg = node.arguments?.[0]
        let keyName = null
        if (keyArg?.type === 'Literal' && typeof keyArg.value === 'string')
          keyName = keyArg.value
        else if (keyArg?.type === 'Identifier') keyName = keyArg.name
        if (keyName && SENSITIVE_KEY.test(keyName)) {
          context.report({
            node,
            messageId: 'sensitiveStorage',
            data: { key: keyName }
          })
        }
      }
    }
  }
}
