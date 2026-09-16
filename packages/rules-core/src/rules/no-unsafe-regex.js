/** no-unsafe-regex —— P0 安全（v0.1① #2，CWE-1333 / OWASP A05）。 */
export default {
  meta: {
    category: 'security',
    severity: 'warning',
    confidence: 'high',
    typeRequirement: 'none',
    tags: ['cwe-1333', 'owasp-a05'],
    fixable: undefined,
    messages: {
      unsafeRegex:
        'Regex has a nested quantifier (ReDoS backtracking pattern); constrain the inner group or use a linear alternative. (no-unsafe-regex)'
    },
    docs: {
      description: '检测正则中的嵌套量词（ReDoS 静态特征）',
      rationale:
        '量词修饰的分组外层再接量词会造成指数级回溯，恶意输入即可打挂服务（ReDoS）。完整可判定性不存在，本条按静态特征保守报。',
      badExamples: ['/(a+)+$/', 'new RegExp("(\\\\d+)*\\\\d")'],
      goodExamples: ['/^[a-z]+\\d{4}$/', 'new RegExp("^\\\\d{4}-\\\\d{2}$")'],
      falsePositives: [
        '特征法对已被锚定/原子组约束的写法仍会告警，按需行内 ignore'
      ]
    }
  },
  create(context) {
    // 特征：量词修饰的分组/字符组后紧跟量词，如 (a+)+、(\d+)*、[ab]+*
    const NESTED = /\((?:[^()\\]|\\.)*[+*]\)\s*[+*{]|\[[^\]\\]*[+*]\]\s*[+*{]/

    function checkPattern(node, pattern) {
      if (typeof pattern === 'string' && NESTED.test(pattern)) {
        context.report({ node, messageId: 'unsafeRegex' })
      }
    }

    return {
      Literal(node) {
        if (node.regex) checkPattern(node, node.regex.pattern)
      },
      NewExpression(node) {
        if (
          node.callee?.type === 'Identifier' &&
          node.callee.name === 'RegExp' &&
          node.arguments?.[0]?.type === 'Literal' &&
          typeof node.arguments[0].value === 'string'
        ) {
          checkPattern(node, node.arguments[0].value)
        }
      }
    }
  }
}
