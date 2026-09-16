/** no-math-random-secret —— P0 安全（v0.1① #8，CWE-338 / OWASP A02，限定同语句维持 none 层）。 */
export default {
  meta: {
    category: 'security',
    severity: 'error',
    confidence: 'medium',
    typeRequirement: 'none',
    tags: ['cwe-338', 'owasp-a02'],
    fixable: undefined,
    messages: {
      mathRandomUsage:
        '"{{name}}" is seeded with Math.random(): it is not cryptographically secure. Use crypto.randomUUID()/getRandomValues. (no-math-random-secret)'
    },
    docs: {
      description:
        '禁止 Math.random 赋值给敏感命名标识符（token/secret/otp/salt 等）',
      rationale:
        'Math.random 是可预测的伪随机数，用于凭证/令牌生成等于可猜测。限定同语句赋值以维持 none 检测层；跨语句追踪属 local（M2）。',
      badExamples: [
        'const token = Math.random()',
        'session.nonce = Math.random()'
      ],
      goodExamples: ['const token = crypto.randomUUID()'],
      falsePositives: [
        '命名启发会漏掉无关命名；确需随机浮点的非安全场景可行内 ignore'
      ]
    }
  },
  create(context) {
    const SECRET_NAME =
      /(token|secret|otp|salt|nonce|api[_-]?key|apikey|password|passwd)/i
    function isMathRandom(node) {
      return (
        node?.type === 'CallExpression' &&
        node.callee?.type === 'MemberExpression' &&
        node.callee.object?.type === 'Identifier' &&
        node.callee.object.name === 'Math' &&
        node.callee.property?.name === 'random'
      )
    }
    function containsMathRandom(node) {
      if (!node || typeof node !== 'object') return false
      if (Array.isArray(node))
        return node.some((child) => containsMathRandom(child))
      if (isMathRandom(node)) return true
      for (const key of Object.keys(node)) {
        if (key === 'parent' || key === 'range' || key === 'loc') continue
        if (containsMathRandom(node[key])) return true
      }
      return false
    }

    return {
      VariableDeclarator(node) {
        if (
          node.id?.type === 'Identifier' &&
          SECRET_NAME.test(node.id.name) &&
          containsMathRandom(node.init)
        ) {
          context.report({
            node,
            messageId: 'mathRandomUsage',
            data: { name: node.id.name }
          })
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
        if (name && SECRET_NAME.test(name) && containsMathRandom(node.right)) {
          context.report({
            node,
            messageId: 'mathRandomUsage',
            data: { name }
          })
        }
      }
    }
  }
}
