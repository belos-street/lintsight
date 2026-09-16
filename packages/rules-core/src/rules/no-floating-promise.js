/** no-floating-promise —— P0 正确性（v0.1① #1，local 层，M2 由 typescript/no-floating-promises 接管）。 */
export default {
  meta: {
    category: 'correctness',
    severity: 'error',
    confidence: 'medium',
    typeRequirement: 'local',
    tags: [],
    fixable: undefined,
    messages: {
      floating:
        'Promise is created but its result is neither awaited, voided, nor returned; rejections become unhandled. (no-floating-promise)'
    },
    docs: {
      description:
        '禁止产生未处理的 Promise（表达式语句中的 Promise 值未 await / void / return）',
      rationale:
        '未被接住的 Promise 一旦 reject 就是 unhandled rejection，线上表现为静默失败；M2 将由 typescript/no-floating-promises（type-aware）接管。',
      badExamples: ['save(id)', 'Promise.resolve(1).then(v => v + 1)'],
      goodExamples: [
        'await save(id)',
        'void fireAndForget()',
        'return save(id)'
      ],
      falsePositives: [
        'fire-and-forget 意图需显式 void 标注（这正是本规则的诉求）',
        '启发式基于同文件 async 声明与 Async 后缀命名，跨文件导入的异步函数可能漏报（保守不误报）'
      ]
    }
  },
  create(context) {
    const PROMISE_STATICS = new Set([
      'resolve',
      'reject',
      'all',
      'allSettled',
      'race',
      'any'
    ])
    const asyncNames = new Set()

    // 预扫描：收集同文件声明的 async 函数/方法名（Program 先于其余 visitor 触发）
    function collectAsyncNames(node) {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) {
        for (const child of node) collectAsyncNames(child)
        return
      }
      if (node.type === 'FunctionDeclaration' && node.async && node.id) {
        asyncNames.add(node.id.name)
      } else if (
        (node.type === 'FunctionExpression' ||
          node.type === 'ArrowFunctionExpression') &&
        node.async &&
        node.id
      ) {
        asyncNames.add(node.id.name)
      } else if (
        node.type === 'MethodDefinition' &&
        node.value?.async &&
        node.key?.type === 'Identifier'
      ) {
        asyncNames.add(node.key.name)
      } else if (
        node.type === 'Property' &&
        node.value?.async &&
        node.key?.type === 'Identifier'
      ) {
        asyncNames.add(node.key.name)
      }
      for (const key of Object.keys(node)) {
        if (key === 'parent' || key === 'range' || key === 'loc') continue
        collectAsyncNames(node[key])
      }
    }

    return {
      Program(node) {
        collectAsyncNames(node)
      },
      ExpressionStatement(node) {
        const expr = node.expression
        if (!expr || expr.type !== 'CallExpression') return
        const callee = expr.callee
        if (!callee) return
        // 链尾 .then(...)：整条链的 rejection 无兜底
        if (
          callee.type === 'MemberExpression' &&
          callee.property?.type === 'Identifier' &&
          callee.property.name === 'then'
        ) {
          context.report({ node: expr, messageId: 'floating' })
          return
        }
        // Promise.xxx 静态构造
        if (
          callee.type === 'MemberExpression' &&
          callee.object?.type === 'Identifier' &&
          callee.object.name === 'Promise' &&
          callee.property?.type === 'Identifier' &&
          PROMISE_STATICS.has(callee.property.name)
        ) {
          context.report({ node: expr, messageId: 'floating' })
          return
        }
        // 同文件 async 声明名 / Async 后缀启发
        const name =
          callee.type === 'Identifier'
            ? callee.name
            : callee.type === 'MemberExpression' &&
                callee.property?.type === 'Identifier'
              ? callee.property.name
              : null
        if (name && (asyncNames.has(name) || name.endsWith('Async'))) {
          context.report({ node: expr, messageId: 'floating' })
        }
      }
    }
  }
}
