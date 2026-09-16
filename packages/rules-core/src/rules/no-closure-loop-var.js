/** no-closure-loop-var —— P0 正确性（v0.1① #5，与内置 no-loop-func 分工见 docs）。 */
export default {
  meta: {
    category: 'correctness',
    severity: 'error',
    confidence: 'high',
    typeRequirement: 'none',
    tags: [],
    fixable: undefined,
    messages: {
      loopVar:
        'Variable declared with "var" inside a loop is captured by a closure: all closures share one binding. Use "let" instead. (no-closure-loop-var)'
    },
    docs: {
      description: '禁止循环内 var 声明的变量被闭包捕获',
      rationale:
        'var 是函数级作用域，循环内闭包共享同一绑定，回调执行时读到的都是最后一次迭代的值；let 每次迭代独立绑定。与内置 eslint/no-loop-func 分工：内置覆盖所有函数表达式捕获（误报面宽）不启用，本条仅 var+捕获，语法可证。',
      badExamples: ['for (var i = 0; i < n; i++) { setTimeout(() => log(i)) }'],
      goodExamples: [
        'for (let i = 0; i < n; i++) { setTimeout(() => log(i)) }'
      ],
      falsePositives: ['循环内 var 但未被任何闭包引用时不报（见 valid 用例）']
    }
  },
  create(context) {
    function collect(node, onVar, onFunction) {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) {
        for (const child of node) collect(child, onVar, onFunction)
        return
      }
      if (node.type === 'VariableDeclaration' && node.kind === 'var') {
        for (const decl of node.declarations ?? []) {
          if (decl.id?.type === 'Identifier') onVar(decl.id.name)
        }
      }
      if (
        node.type === 'FunctionDeclaration' ||
        node.type === 'FunctionExpression' ||
        node.type === 'ArrowFunctionExpression'
      ) {
        onFunction(node)
      }
      for (const key of Object.keys(node)) {
        if (key === 'parent' || key === 'range' || key === 'loc') continue
        collect(node[key], onVar, onFunction)
      }
    }

    function referencesAny(node, names) {
      if (!node || typeof node !== 'object') return false
      if (Array.isArray(node))
        return node.some((child) => referencesAny(child, names))
      if (node.type === 'Identifier' && names.has(node.name)) return true
      for (const key of Object.keys(node)) {
        if (key === 'parent' || key === 'range' || key === 'loc') continue
        if (referencesAny(node[key], names)) return true
      }
      return false
    }

    function checkLoop(loop) {
      const varNames = new Set()
      const functions = []
      // 循环头部的 var（for init / for-in|of left）
      for (const part of [loop.init, loop.left]) {
        if (part?.type === 'VariableDeclaration' && part.kind === 'var') {
          for (const decl of part.declarations ?? []) {
            if (decl.id?.type === 'Identifier') varNames.add(decl.id.name)
          }
        }
      }
      collect(
        loop.body,
        (name) => varNames.add(name),
        (fn) => functions.push(fn)
      )
      if (varNames.size === 0 || functions.length === 0) return
      for (const fn of functions) {
        if (referencesAny(fn.body, varNames)) {
          context.report({ node: loop, messageId: 'loopVar' })
          return
        }
      }
    }

    return {
      ForStatement: checkLoop,
      ForInStatement: checkLoop,
      ForOfStatement: checkLoop,
      WhileStatement: checkLoop,
      DoWhileStatement: checkLoop
    }
  }
}
