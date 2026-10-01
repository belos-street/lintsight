/** no-hardcoded-credentials —— P0 安全（v0.1① #1，CWE-798 / OWASP A07·A02）。 */
export default {
  meta: {
    category: 'security',
    severity: 'error',
    confidence: 'medium',
    typeRequirement: 'none',
    tags: ['cwe-798', 'owasp-a07'],
    fixable: undefined,
    messages: {
      hardcoded:
        'Possible hardcoded credential for "{{name}}": move it to environment variables or a secret manager. (no-hardcoded-credentials)'
    },
    docs: {
      description:
        '禁止硬编码凭证（password/secret/token/api_key 等命名 + 字符串字面量）',
      rationale:
        '硬编码凭证会随代码进仓库与构建产物，泄露后难以轮换；应走环境变量或密钥管理服务。',
      badExamples: [
        "const apiKey = 'sk-live-9af83c2e7b'",
        "db.password = 'sup3r-s3cret'"
      ],
      goodExamples: ['const apiKey = process.env.API_KEY'],
      falsePositives: [
        '键名命中但值为占位/空/非凭证语义（长度 < 6 的字符串不触发）',
        '值与键名自指（normalize 后相同，如 ACCESS_TOKEN = "access_token"）——值只是键名的机器形式复述，零信息量（T1.19 #3 误报反哺：hono 项目 cookie 名常量）',
        '裸 token 属性承载非凭证语义（语言学词元/设计 token 等）：值不含数字/非字母字符且长度 < 12 时不触发（Lexio 项目 diffTokens 词元误报实证，T1.19 #2）',
        '测试文件的样例凭证（后续可加 test 目录豁免选项）'
      ]
    }
  },
  create(context) {
    const NAME =
      /(password|passwd|pwd|secret|token|api[_-]?key|apikey|private[_-]?key|access[_-]?key)/i

    function isSuspectName(name) {
      return typeof name === 'string' && NAME.test(name)
    }
    // 值与键名自指（normalize 后相同，如 ACCESS_TOKEN = 'access_token'）→ 跳过：
    // 值只是键名的机器形式复述，信息量为零（T1.19 #3 误报反哺）
    function isSelfReferential(name, value) {
      if (typeof name !== 'string') return false
      const norm = (s) => s.toLowerCase().replace(/[_\-\s]/g, '')
      return norm(value.value) === norm(name)
    }
    function isCredentialLiteral(value, name) {
      if (
        value?.type !== 'Literal' ||
        typeof value.value !== 'string' ||
        value.value.length < 6
      ) {
        return false
      }
      if (isSelfReferential(name, value)) return false
      // 裸 token 多义（语言学词元/设计 token/会话 token）——要求值具备凭证形态：
      // 含数字或非字母字符，或长度 ≥ 12；纯字母短词不触发（T1.19 #2 误报反哺）
      if (/^token$/i.test(name ?? '')) {
        const v = value.value
        return v.length >= 12 || /\d/.test(v) || /[^a-zA-Z]/.test(v)
      }
      return true
    }
    function report(node, name) {
      context.report({ node, messageId: 'hardcoded', data: { name } })
    }

    return {
      VariableDeclarator(node) {
        if (
          node.id?.type === 'Identifier' &&
          isSuspectName(node.id.name) &&
          isCredentialLiteral(node.init, node.id.name)
        ) {
          report(node, node.id.name)
        }
      },
      Property(node) {
        const keyName =
          node.key?.type === 'Identifier' ? node.key.name : node.key?.value
        if (
          node.kind === 'init' &&
          isSuspectName(keyName) &&
          isCredentialLiteral(node.value, keyName)
        ) {
          report(node, keyName)
        }
      },
      AssignmentExpression(node) {
        const target = node.left
        const name =
          target?.type === 'Identifier'
            ? target.name
            : target?.type === 'MemberExpression' &&
                target.property?.type === 'Identifier'
              ? target.property.name
              : null
        if (isSuspectName(name) && isCredentialLiteral(node.right, name)) {
          report(node, name)
        }
      }
    }
  }
}
