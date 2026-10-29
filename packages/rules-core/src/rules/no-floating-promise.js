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
        '同文件 async 函数内部已完整 try/catch 且 catch 不 rethrow → 视为已处理，不报（cleancode-sast-web bootstrap 误报，T1.19 反哺）',
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
    const selfHandledAsync = new Set()

    const isFunctionNode = (n) =>
      n?.type === 'FunctionDeclaration' ||
      n?.type === 'FunctionExpression' ||
      n?.type === 'ArrowFunctionExpression'

    /** 内部已兜住错误（T1.19 反哺）：函数体内所有 await 都位于「带 catch 且
     * catch 不 rethrow」的 try 中 → 调用不会产生 unhandled rejection
     * （cleancode-sast-web 的 bootstrap fetch 脚本误报实证）。 */
    function isSelfHandled(fn) {
      const body = fn.body
      if (!fn.async || body?.type !== 'BlockStatement') return false
      const awaits = []
      const handled = new Set()
      const collect = (node, out) => {
        if (!node || typeof node !== 'object') return
        if (Array.isArray(node)) {
          for (const c of node) collect(c, out)
          return
        }
        if (isFunctionNode(node)) return // 嵌套函数属另一错误处理作用域
        if (node.type === 'AwaitExpression') out.push(node)
        for (const key of Object.keys(node)) {
          if (key === 'parent' || key === 'range' || key === 'loc') continue
          collect(node[key], out)
        }
      }
      collect(body, awaits)
      if (awaits.length === 0) return false
      const visitTry = (node) => {
        if (!node || typeof node !== 'object') return
        if (Array.isArray(node)) {
          for (const c of node) visitTry(c)
          return
        }
        if (isFunctionNode(node)) return
        if (node.type === 'TryStatement' && node.handler) {
          const throws = []
          const collectThrows = (n) => {
            if (!n || typeof n !== 'object') return
            if (Array.isArray(n)) {
              for (const c of n) collectThrows(c)
              return
            }
            if (isFunctionNode(n)) return
            if (n.type === 'ThrowStatement') throws.push(n)
            for (const key of Object.keys(n)) {
              if (key === 'parent' || key === 'range' || key === 'loc') continue
              collectThrows(n[key])
            }
          }
          collectThrows(node.handler.body)
          if (throws.length === 0) {
            const tryAwaits = []
            collect(node.block, tryAwaits)
            for (const a of tryAwaits) handled.add(a)
          }
        }
        for (const key of Object.keys(node)) {
          if (key === 'parent' || key === 'range' || key === 'loc') continue
          visitTry(node[key])
        }
      }
      visitTry(body)
      return awaits.every((a) => handled.has(a))
    }

    // 预扫描：收集同文件声明的 async 函数/方法名（Program 先于其余 visitor 触发）
    function collectAsyncNames(node) {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) {
        for (const child of node) collectAsyncNames(child)
        return
      }
      if (node.type === 'FunctionDeclaration' && node.async && node.id) {
        if (isSelfHandled(node)) selfHandledAsync.add(node.id.name)
        else asyncNames.add(node.id.name)
      } else if (
        (node.type === 'FunctionExpression' ||
          node.type === 'ArrowFunctionExpression') &&
        node.async &&
        node.id
      ) {
        if (isSelfHandled(node)) selfHandledAsync.add(node.id.name)
        else asyncNames.add(node.id.name)
      } else if (
        node.type === 'MethodDefinition' &&
        node.value?.async &&
        node.key?.type === 'Identifier'
      ) {
        if (isSelfHandled(node.value)) selfHandledAsync.add(node.key.name)
        else asyncNames.add(node.key.name)
      } else if (
        node.type === 'Property' &&
        node.value?.async &&
        node.key?.type === 'Identifier'
      ) {
        if (isSelfHandled(node.value)) selfHandledAsync.add(node.key.name)
        else asyncNames.add(node.key.name)
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
        if (
          name &&
          !selfHandledAsync.has(name) &&
          (asyncNames.has(name) || name.endsWith('Async'))
        ) {
          context.report({ node: expr, messageId: 'floating' })
        }
      }
    }
  }
}
