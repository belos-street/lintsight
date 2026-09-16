/** no-async-constructor-call —— P0 正确性（v0.1① #10）。 */
export default {
  meta: {
    category: 'correctness',
    severity: 'warning',
    confidence: 'medium',
    typeRequirement: 'none',
    tags: [],
    fixable: undefined,
    messages: {
      asyncConstructorCall:
        'Async method "{{name}}" is called in constructor without await: async initialization is not complete. Use void to make it explicit, or move it out. (no-async-constructor-call)'
    },
    docs: {
      description: '禁止 constructor 中调用本类 async 方法而不 await / void',
      rationale:
        'constructor 无法 await，异步初始化被静默丢弃；应显式 void（表明 fire-and-forget）或将初始化移出构造器。',
      badExamples: ['constructor() { this.connect() }'],
      goodExamples: [
        'constructor() { void this.connect() }',
        'const c = new Client(); await c.connect()'
      ],
      falsePositives: ['.then 链亦视为未完成初始化（本条从严）']
    }
  },
  create(context) {
    function findHandledCalls(node, handled) {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) {
        for (const child of node) findHandledCalls(child, handled)
        return
      }
      if (
        node.type === 'AwaitExpression' &&
        node.argument?.type === 'CallExpression'
      ) {
        handled.add(node.argument)
      }
      if (
        node.type === 'UnaryExpression' &&
        node.operator === 'void' &&
        node.argument?.type === 'CallExpression'
      ) {
        handled.add(node.argument)
      }
      for (const key of Object.keys(node)) {
        if (key === 'parent' || key === 'range' || key === 'loc') continue
        findHandledCalls(node[key], handled)
      }
    }

    function findAsyncConstructorCalls(node, asyncMethods, handled) {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) {
        for (const child of node)
          findAsyncConstructorCalls(child, asyncMethods, handled)
        return
      }
      // 嵌套函数体内的调用归该函数自身语境，不在 constructor 面内
      if (
        node.type === 'FunctionDeclaration' ||
        node.type === 'FunctionExpression' ||
        node.type === 'ArrowFunctionExpression'
      ) {
        return
      }
      if (
        node.type === 'CallExpression' &&
        node.callee?.type === 'MemberExpression' &&
        node.callee.object?.type === 'ThisExpression' &&
        node.callee.property?.type === 'Identifier' &&
        asyncMethods.has(node.callee.property.name) &&
        !handled.has(node)
      ) {
        context.report({
          node,
          messageId: 'asyncConstructorCall',
          data: { name: node.callee.property.name }
        })
      }
      for (const key of Object.keys(node)) {
        if (key === 'parent' || key === 'range' || key === 'loc') continue
        findAsyncConstructorCalls(node[key], asyncMethods, handled)
      }
    }

    return {
      MethodDefinition(node) {
        if (node.kind !== 'constructor') return
        const classNode = node.parent?.parent
        if (!classNode || !Array.isArray(classNode.body?.body)) return
        const asyncMethods = new Set()
        for (const el of classNode.body.body) {
          if (
            el.type === 'MethodDefinition' &&
            el.kind !== 'constructor' &&
            el.value?.async &&
            el.key?.type === 'Identifier'
          ) {
            asyncMethods.add(el.key.name)
          }
        }
        if (asyncMethods.size === 0) return
        const body = node.value?.body
        if (!body) return
        const handled = new Set()
        findHandledCalls(body, handled)
        findAsyncConstructorCalls(body, asyncMethods, handled)
      }
    }
  }
}
