/**
 * no-unsafe-trust-bypass —— M3 召回扩充（FR-303 安全面，CWE-79 / OWASP A03）。
 * Angular DomSanitizer.bypassSecurityTrust* 绕过框架 XSS 防护；实参非纯
 * 字面量 = 把动态内容标记为可信 HTML/Script/URL，是 Angular XSS 主入口
 * （juice-shop localXss/xssBonus 埋洞形态）。
 */
export default {
  meta: {
    category: 'security',
    severity: 'error',
    confidence: 'medium',
    typeRequirement: 'none',
    tags: ['cwe-79', 'owasp-a03'],
    fixable: undefined,
    messages: {
      trustBypass:
        'Passing non-literal content to "{{sink}}" disables the framework XSS defense; sanitize instead of marking untrusted input as safe. (no-unsafe-trust-bypass)'
    },
    docs: {
      description:
        '禁止向 Angular bypassSecurityTrust* 传入非字面量内容（绕过 XSS 防护）',
      rationale:
        'bypassSecurityTrust* 把动态内容标记为可信，框架不再净化；与 no-innerhtml-assignment 互补——后者管 DOM sink，本条管「信任标记」入口。',
      badExamples: [
        'this.sanitizer.bypassSecurityTrustResourceUrl(queryParam)',
        'this.sanitizer.bypassSecurityTrustHtml(`<b>${userInput}</b>`)'
      ],
      goodExamples: [
        "this.sanitizer.bypassSecurityTrustHtml('<b>static</b>')",
        'this.sanitizer.sanitize(SecurityContext.HTML, dirty)'
      ],
      falsePositives: [
        '实参已过净化器（DOMPurify 等）的场景不可静态判定——保守报告，可配 allow 豁免',
        'Service Worker/富文本编辑器等有意信任边界处（安全评审后 allow）'
      ]
    }
  },
  create(context) {
    // trust 方法全集（Angular DomSanitizer 公开面）
    const TRUST_METHODS = new Set([
      'bypassSecurityTrustHtml',
      'bypassSecurityTrustScript',
      'bypassSecurityTrustStyle',
      'bypassSecurityTrustUrl',
      'bypassSecurityTrustResourceUrl'
    ])

    function isStaticContent(node) {
      if (!node) return true // 无实参不报
      if (node.type === 'Literal') return true
      if (node.type === 'TemplateLiteral') return node.expressions.length === 0
      return false
    }

    return {
      CallExpression(node) {
        const callee = node.callee
        if (
          callee?.type !== 'MemberExpression' ||
          callee.property?.type !== 'Identifier' ||
          !TRUST_METHODS.has(callee.property.name)
        ) {
          return
        }
        const arg0 = node.arguments?.[0]
        if (!isStaticContent(arg0)) {
          context.report({
            node,
            messageId: 'trustBypass',
            data: { sink: callee.property.name }
          })
        }
      }
    }
  }
}
