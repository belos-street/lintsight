/** no-weak-hash —— P0 安全（v0.1① #7，CWE-327 / OWASP A02）。 */
export default {
  meta: {
    category: 'security',
    severity: 'warning',
    confidence: 'high',
    typeRequirement: 'none',
    tags: ['cwe-327', 'owasp-a02'],
    fixable: undefined,
    messages: {
      weakHash:
        '"{{algo}}" is a broken hash algorithm: use SHA-256+ or a password-specific KDF. (no-weak-hash)'
    },
    docs: {
      description: '禁止 MD5/SHA1 哈希（crypto.createHash 字面量参数）',
      rationale:
        'MD5/SHA1 已被证实存在碰撞攻击，用于完整性/签名场景不再安全；密码存储应用 bcrypt/argon2 等 KDF。',
      badExamples: ["crypto.createHash('md5')"],
      goodExamples: ["crypto.createHash('sha256')"],
      falsePositives: [
        '非安全场景（缓存键/分片）可配 allow；算法为变量时保守不报'
      ]
    }
  },
  create(context) {
    const WEAK = new Set(['md5', 'sha1'])
    return {
      CallExpression(node) {
        const callee = node.callee
        if (
          callee?.type !== 'MemberExpression' ||
          callee.property?.name !== 'createHash'
        )
          return
        const arg0 = node.arguments?.[0]
        if (arg0?.type !== 'Literal' || typeof arg0.value !== 'string') return
        const algo = arg0.value.toLowerCase()
        if (WEAK.has(algo)) {
          context.report({ node, messageId: 'weakHash', data: { algo } })
        }
      }
    }
  }
}
