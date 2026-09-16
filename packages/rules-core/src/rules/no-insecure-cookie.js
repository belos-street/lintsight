/** no-insecure-cookie —— P0 安全（v0.1① #14，CWE-614/1004 / OWASP A05）。 */
export default {
  meta: {
    category: 'security',
    severity: 'warning',
    confidence: 'medium',
    typeRequirement: 'none',
    tags: ['cwe-614', 'cwe-1004', 'owasp-a05'],
    fixable: undefined,
    messages: {
      insecureCookie:
        'Cookie is set without HttpOnly/Secure: it is readable by scripts and sent over plain HTTP. (no-insecure-cookie)'
    },
    docs: {
      description: 'Set-Cookie 缺少 HttpOnly/Secure 标志',
      rationale:
        '缺 HttpOnly 可被脚本读取（XSS 窃取会话），缺 Secure 会经明文传输。与内置 unicorn/no-document-cookie 分工：内置管 document.cookie 赋值，本条管 Set-Cookie 字符串与框架 cookie 选项。',
      badExamples: [
        "res.setHeader('Set-Cookie', 'sid=1; Path=/')",
        "res.cookie('sid', id)"
      ],
      goodExamples: [
        "res.setHeader('Set-Cookie', 'sid=1; HttpOnly; Secure')",
        "res.cookie('sid', id, { httpOnly: true, secure: true })"
      ],
      falsePositives: [
        '非会话类 cookie（统计）可配 allow；非 express 系框架选项面逐步扩展'
      ]
    }
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee
        if (
          callee?.type !== 'MemberExpression' ||
          callee.property?.type !== 'Identifier'
        )
          return

        // Set-Cookie 字符串形态
        if (callee.property.name === 'setHeader') {
          const name = node.arguments?.[0]
          const value = node.arguments?.[1]
          if (
            name?.type === 'Literal' &&
            /set-cookie/i.test(String(name.value))
          ) {
            const cookie = String(value?.value ?? '')
            if (!/httponly/i.test(cookie) || !/secure/i.test(cookie)) {
              context.report({ node, messageId: 'insecureCookie' })
            }
          }
          return
        }
        // res.cookie(name, value, options) 形态
        if (callee.property.name === 'cookie') {
          const options = node.arguments?.[2]
          if (options?.type !== 'ObjectExpression') {
            context.report({ node, messageId: 'insecureCookie' })
            return
          }
          let httpOnly = false
          let secure = false
          for (const prop of options.properties ?? []) {
            const key =
              prop.key?.type === 'Identifier' ? prop.key.name : prop.key?.value
            if (key === 'httpOnly' && prop.value?.value === true)
              httpOnly = true
            if (key === 'secure' && prop.value?.value === true) secure = true
          }
          if (!httpOnly || !secure) {
            context.report({ node, messageId: 'insecureCookie' })
          }
        }
      }
    }
  }
}
