// packages/rules-core/src/rules/no-empty-catch.js
var no_empty_catch_default = {
  meta: {
    category: 'correctness',
    severity: 'error',
    confidence: 'high',
    typeRequirement: 'none',
    tags: [],
    fixable: undefined,
    messages: {
      emptyCatch:
        'Unexpected empty catch block. Handle the error or rethrow it. (no-empty-catch)'
    },
    docs: {
      description: '禁止空的 catch 块',
      rationale:
        '空 catch 会静默吞掉错误，掩盖线上故障的根因；应处理、记录或重新抛出。',
      badExamples: ['try { risky(); } catch (e) {}'],
      goodExamples: [
        'try { risky(); } catch (e) { logger.error(e); throw e; }'
      ],
      falsePositives: [
        '注释占位的 catch 也会告警（零语句即触发）——正式版可增加 allowComments 选项'
      ]
    }
  },
  create(context) {
    return {
      CatchClause(node) {
        const statements = node.body?.body ?? []
        if (statements.length === 0) {
          context.report({ node, messageId: 'emptyCatch' })
        }
      }
    }
  }
}

// packages/rules-core/src/rules/no-async-array-method.js
var no_async_array_method_default = {
  meta: {
    category: 'correctness',
    severity: 'error',
    confidence: 'high',
    typeRequirement: 'none',
    tags: [],
    fixable: undefined,
    messages: {
      asyncArrayMethod:
        'Array.prototype.{{method}} does not await async callbacks: the returned Promise is ignored. Use for...of with await, or Promise.all. (no-async-array-method)'
    },
    docs: {
      description: '禁止向 forEach/map/filter/reduce 等数组方法传入 async 回调',
      rationale:
        '数组方法不感知 Promise，async 回调返回的 Promise 被静默丢弃：forEach 的异常不会冒泡、map 的结果不是数据而是 Promise 数组、reduce 的聚合值是 Promise。',
      badExamples: ['ids.forEach(async (id) => { await save(id) })'],
      goodExamples: [
        'for (const id of ids) { await save(id) }',
        'await Promise.all(ids.map((id) => save(id)))'
      ],
      falsePositives: [
        '自定义类实现同名方法且确有 Promise 语义时误报（duck typing 限制，可行内 ignore）'
      ]
    }
  },
  create(context) {
    const METHODS = new Set([
      'forEach',
      'map',
      'filter',
      'reduce',
      'reduceRight',
      'some',
      'every'
    ])
    function consumedByPromiseAll(node) {
      const parent = node.parent
      if (parent?.type !== 'CallExpression') return false
      const pc = parent.callee
      return (
        pc?.type === 'MemberExpression' &&
        pc.object?.type === 'Identifier' &&
        pc.object.name === 'Promise' &&
        pc.property?.name === 'all'
      )
    }
    return {
      CallExpression(node) {
        const callee = node.callee
        if (!callee || callee.type !== 'MemberExpression') return
        if (!callee.property || callee.property.type !== 'Identifier') return
        const method = callee.property.name
        if (!METHODS.has(method)) return
        const cb = node.arguments?.[0]
        if (!cb) return
        if (
          (cb.type === 'ArrowFunctionExpression' ||
            cb.type === 'FunctionExpression') &&
          cb.async &&
          !(method === 'map' && consumedByPromiseAll(node))
        ) {
          context.report({
            node,
            messageId: 'asyncArrayMethod',
            data: { method }
          })
        }
      }
    }
  }
}

// packages/rules-core/src/rules/no-floating-promise.js
var no_floating_promise_default = {
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
        if (
          callee.type === 'MemberExpression' &&
          callee.property?.type === 'Identifier' &&
          callee.property.name === 'then'
        ) {
          context.report({ node: expr, messageId: 'floating' })
          return
        }
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

// packages/rules-core/src/rules/no-swallowed-promise-error.js
var no_swallowed_promise_error_default = {
  meta: {
    category: 'correctness',
    severity: 'error',
    confidence: 'medium',
    typeRequirement: 'none',
    tags: [],
    fixable: undefined,
    messages: {
      swallowed:
        'Caught error "{{name}}" is neither referenced nor rethrown: the failure is silently swallowed. (no-swallowed-promise-error)'
    },
    docs: {
      description: '禁止 catch 到错误后既不引用也不重新抛出',
      rationale:
        '吞错是故障排查的第一障碍；至少应记录、上报或原样/包装抛出。与 no-unused-vars(caughtErrors) 分工：内置只管「未使用变量」，本条语义是「吞错」（未引用且无任何处理动作）。',
      badExamples: ['catch (e) { console.error("failed") }'],
      goodExamples: [
        'catch (e) { console.error("failed", e) }',
        'catch (e) { throw e }'
      ],
      falsePositives: [
        '无 binding 的 catch {} 由 no-empty-catch 覆盖（零语句）或属有意忽略',
        '仅记录上下文但确认错误无需处理的场景，可行内 ignore'
      ]
    }
  },
  create(context) {
    function walk(node, match) {
      if (!node || typeof node !== 'object') return false
      if (Array.isArray(node)) return node.some((child) => walk(child, match))
      if (match(node)) return true
      for (const key of Object.keys(node)) {
        if (key === 'parent' || key === 'range' || key === 'loc') continue
        if (walk(node[key], match)) return true
      }
      return false
    }
    return {
      CatchClause(node) {
        if (!node.param || node.param.type !== 'Identifier') return
        const name = node.param.name
        const hasReference = walk(
          node.body,
          (n) => n.type === 'Identifier' && n.name === name
        )
        const hasThrow = walk(node.body, (n) => n.type === 'ThrowStatement')
        if (!hasReference && !hasThrow) {
          context.report({ node, messageId: 'swallowed', data: { name } })
        }
      }
    }
  }
}

// packages/rules-core/src/rules/no-closure-loop-var.js
var no_closure_loop_var_default = {
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

// packages/rules-core/src/rules/no-array-map-side-effect.js
var no_array_map_side_effect_default = {
  meta: {
    category: 'correctness',
    severity: 'warning',
    confidence: 'medium',
    typeRequirement: 'none',
    tags: [],
    fixable: undefined,
    messages: {
      mapSideEffect:
        'Return value of .map() is discarded: use forEach for side effects, or consume the mapped result. (no-array-map-side-effect)'
    },
    docs: {
      description: '禁止丢弃 map 的返回结果（回调有返回值却被当作语句执行）',
      rationale:
        'map 的契约是「转换并产出新数组」，结果被丢弃说明意图是副作用，应使用 forEach；丢弃有返回值的映射结果多半是漏接 bug。回调漏 return 的场景由映射清单 array-callback-return 覆盖。',
      badExamples: ['users.map((u) => send(u))'],
      goodExamples: [
        'const names = users.map((u) => u.name)',
        'users.forEach((u) => send(u))'
      ],
      falsePositives: [
        '链中后续仍消费 map 结果的中间写法（本条只看语句级丢弃）'
      ]
    }
  },
  create(context) {
    function hasReturnWithArgument(node) {
      if (!node || typeof node !== 'object') return false
      if (Array.isArray(node))
        return node.some((child) => hasReturnWithArgument(child))
      if (node.type === 'ReturnStatement' && node.argument) return true
      for (const key of Object.keys(node)) {
        if (key === 'parent' || key === 'range' || key === 'loc') continue
        if (hasReturnWithArgument(node[key])) return true
      }
      return false
    }
    return {
      ExpressionStatement(node) {
        const expr = node.expression
        if (expr?.type !== 'CallExpression') return
        const callee = expr.callee
        if (
          callee?.type !== 'MemberExpression' ||
          callee.property?.name !== 'map'
        )
          return
        const cb = expr.arguments?.[0]
        if (!cb) return
        const returns =
          cb.type === 'ArrowFunctionExpression' &&
          cb.body?.type !== 'BlockStatement'
            ? true
            : !!cb.body && hasReturnWithArgument(cb.body)
        if (returns) {
          context.report({ node: expr, messageId: 'mapSideEffect' })
        }
      }
    }
  }
}

// packages/rules-core/src/rules/no-json-structured-clone.js
var no_json_structured_clone_default = {
  meta: {
    category: 'correctness',
    severity: 'warning',
    confidence: 'high',
    typeRequirement: 'none',
    tags: [],
    fixable: undefined,
    messages: {
      structuredClone:
        'JSON.parse(JSON.stringify(...)) silently drops Date, Map, Set, undefined and functions; use structuredClone(). (no-json-structured-clone)'
    },
    docs: {
      description: '禁止用 JSON 序列化做深拷贝',
      rationale:
        'JSON 往返会静默丢失 Date/Map/Set/undefined/函数/循环引用，是常见的数据损坏源；运行环境支持时用 structuredClone()。',
      badExamples: ['const copy = JSON.parse(JSON.stringify(state))'],
      goodExamples: ['const copy = structuredClone(state)'],
      falsePositives: ['确知数据为纯 JSON 可序列化结构时可配 allow: true']
    }
  },
  create(context) {
    function isJsonCall(node, method) {
      return (
        node?.type === 'CallExpression' &&
        node.callee?.type === 'MemberExpression' &&
        node.callee.object?.type === 'Identifier' &&
        node.callee.object.name === 'JSON' &&
        node.callee.property?.name === method
      )
    }
    return {
      CallExpression(node) {
        if (!isJsonCall(node, 'parse')) return
        const arg = node.arguments?.[0]
        if (isJsonCall(arg, 'stringify')) {
          context.report({ node, messageId: 'structuredClone' })
        }
      }
    }
  }
}

// packages/rules-core/src/rules/no-ignored-reduce-result.js
var no_ignored_reduce_result_default = {
  meta: {
    category: 'correctness',
    severity: 'error',
    confidence: 'high',
    typeRequirement: 'none',
    tags: [],
    fixable: undefined,
    messages: {
      ignoredReduce:
        'Return value of .reduce() is discarded: the aggregation result is lost. (no-ignored-reduce-result)'
    },
    docs: {
      description: '禁止丢弃 reduce/reduceRight 的聚合结果',
      rationale:
        'reduce 的契约是聚合产出；结果被丢弃说明遍历目的与写法不符，聚合逻辑多半白做。',
      badExamples: ['items.reduce((acc, n) => acc + n, 0)'],
      goodExamples: ['const total = items.reduce((acc, n) => acc + n, 0)'],
      falsePositives: ['无']
    }
  },
  create(context) {
    return {
      ExpressionStatement(node) {
        const expr = node.expression
        if (expr?.type !== 'CallExpression') return
        const prop = expr.callee?.property
        if (
          prop?.type === 'Identifier' &&
          (prop.name === 'reduce' || prop.name === 'reduceRight')
        ) {
          context.report({ node: expr, messageId: 'ignoredReduce' })
        }
      }
    }
  }
}

// packages/rules-core/src/rules/no-empty-promise-catch.js
var no_empty_promise_catch_default = {
  meta: {
    category: 'correctness',
    severity: 'error',
    confidence: 'high',
    typeRequirement: 'none',
    tags: [],
    fixable: undefined,
    messages: {
      emptyCatchCallback:
        '.catch() handler is empty: the rejection is silently swallowed. Handle the error or rethrow it. (no-empty-promise-catch)'
    },
    docs: {
      description: '禁止 .catch(() => {}) 形式的静默吞错',
      rationale:
        '空 catch 回调与空 catch 块同样危险；与 no-empty-catch 分工：本条管 promise 链的回调面。',
      badExamples: ['fetch(url).catch(() => {})'],
      goodExamples: ['fetch(url).catch((e) => logger.error(e))'],
      falsePositives: [
        '命名处理器（.catch(handleError)）无法证明为空，保守不报'
      ]
    }
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee
        if (
          callee?.type !== 'MemberExpression' ||
          callee.property?.name !== 'catch'
        )
          return
        const cb = node.arguments?.[0]
        if (!cb) return
        const isEmpty =
          (cb.type === 'ArrowFunctionExpression' ||
            cb.type === 'FunctionExpression') &&
          ((cb.body?.type === 'BlockStatement' && cb.body.body.length === 0) ||
            (cb.body?.type === 'Identifier' && cb.body.name === 'undefined'))
        if (isEmpty) {
          context.report({ node, messageId: 'emptyCatchCallback' })
        }
      }
    }
  }
}

// packages/rules-core/src/rules/no-async-constructor-call.js
var no_async_constructor_call_default = {
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

// packages/rules-core/src/rules/no-sync-io-in-async.js
var no_sync_io_in_async_default = {
  meta: {
    category: 'correctness',
    severity: 'warning',
    confidence: 'high',
    typeRequirement: 'none',
    tags: [],
    fixable: undefined,
    messages: {
      syncIo:
        '"{{name}}" blocks the event loop inside an async function; use the promise API instead. (no-sync-io-in-async)'
    },
    docs: {
      description: '禁止在 async 函数内调用文件系统同步 API',
      rationale:
        'async 的价值是让出事件循环；内部再调 *Sync 会阻塞整个进程，高并发下是吞吐杀手。',
      badExamples: ['async function load(p) { return readFileSync(p) }'],
      goodExamples: ['async function load(p) { return readFile(p, "utf8") }'],
      falsePositives: ['启动期一次性脚本中的同步 IO（可忽略或行内 ignore）']
    }
  },
  create(context) {
    const SYNC_IO = new Set([
      'readFileSync',
      'writeFileSync',
      'appendFileSync',
      'existsSync',
      'mkdirSync',
      'rmSync',
      'rmdirSync',
      'unlinkSync',
      'copyFileSync',
      'statSync',
      'lstatSync',
      'readdirSync',
      'renameSync',
      'accessSync'
    ])
    function walkNoFunctions(node, onCall) {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) {
        for (const child of node) walkNoFunctions(child, onCall)
        return
      }
      if (
        node.type === 'FunctionDeclaration' ||
        node.type === 'FunctionExpression' ||
        node.type === 'ArrowFunctionExpression'
      ) {
        return
      }
      if (node.type === 'CallExpression') onCall(node)
      for (const key of Object.keys(node)) {
        if (key === 'parent' || key === 'range' || key === 'loc') continue
        walkNoFunctions(node[key], onCall)
      }
    }
    function check(node) {
      if (!node.async) return
      walkNoFunctions(node.body, (call) => {
        const callee = call.callee
        let name = null
        if (callee?.type === 'Identifier') name = callee.name
        else if (
          callee?.type === 'MemberExpression' &&
          callee.property?.type === 'Identifier'
        ) {
          name = callee.property.name
        }
        if (name && SYNC_IO.has(name)) {
          context.report({ node: call, messageId: 'syncIo', data: { name } })
        }
      })
    }
    return {
      FunctionDeclaration: check,
      FunctionExpression: check,
      ArrowFunctionExpression: check
    }
  }
}

// packages/rules-core/src/index.js
var src_default = {
  name: 'lintsight',
  meta: { name: 'lintsight' },
  rules: {
    'no-empty-catch': no_empty_catch_default,
    'no-async-array-method': no_async_array_method_default,
    'no-floating-promise': no_floating_promise_default,
    'no-swallowed-promise-error': no_swallowed_promise_error_default,
    'no-closure-loop-var': no_closure_loop_var_default,
    'no-array-map-side-effect': no_array_map_side_effect_default,
    'no-json-structured-clone': no_json_structured_clone_default,
    'no-ignored-reduce-result': no_ignored_reduce_result_default,
    'no-empty-promise-catch': no_empty_promise_catch_default,
    'no-async-constructor-call': no_async_constructor_call_default,
    'no-sync-io-in-async': no_sync_io_in_async_default
  }
}
export { src_default as default }
