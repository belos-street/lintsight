/** no-sql-concat —— P0 安全（v0.1① #11，CWE-89 / OWASP A03）。 */
export default {
  meta: {
    category: 'security',
    severity: 'error',
    confidence: 'medium',
    typeRequirement: 'none',
    tags: ['cwe-89', 'owasp-a03'],
    fixable: undefined,
    messages: {
      sqlConcat:
        'SQL built by string interpolation/concatenation enables injection; use parameterized queries (?, $1, :name). (no-sql-concat)'
    },
    docs: {
      description: '禁止模板插值/字符串拼接构造 SQL 语句',
      rationale:
        'SQL 语句内插用户输入即注入面；应使用参数化查询。检测特征：模板串以 SELECT/INSERT/UPDATE/DELETE 开头且含插值，或 SQL 字面量与非字面量拼接。',
      badExamples: [
        '`SELECT * FROM users WHERE id = ${id}`',
        "'SELECT ... WHERE name = ' + name"
      ],
      goodExamples: ["db.query('SELECT * FROM users WHERE id = ?', [id])"],
      falsePositives: ['以 SQL 关键词开头但非 SQL 的文案拼接（命名避让）']
    }
  },
  create(context) {
    const SQL_START = /^\s*(select|insert|update|delete)\b/i

    return {
      TemplateLiteral(node) {
        if (node.expressions.length === 0) return
        const head = node.quasis?.[0]?.value?.raw ?? ''
        if (SQL_START.test(head)) {
          context.report({ node, messageId: 'sqlConcat' })
        }
      },
      BinaryExpression(node) {
        if (node.operator !== '+') return
        const left = node.left
        if (
          left?.type === 'Literal' &&
          typeof left.value === 'string' &&
          SQL_START.test(left.value)
        ) {
          if (node.right?.type !== 'Literal') {
            context.report({ node, messageId: 'sqlConcat' })
          }
        }
      }
    }
  }
}
