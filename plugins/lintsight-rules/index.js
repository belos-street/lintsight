// packages/rules-core/src/rules/no-empty-catch.js
var no_empty_catch_default = {
  meta: {
    category: 'correctness',
    severity: 'error',
    confidence: 'high',
    typeRequirement: 'none',
    tags: [],
    fixable: undefined,
    schema: [
      {
        type: 'object',
        properties: { allowComments: { type: 'boolean' } },
        additionalProperties: false
      }
    ],
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
        '注释占位的 catch 默认仍告警（零语句即触发）；allowComments 选项可放行，默认关闭'
      ]
    }
  },
  create(context) {
    const opts = Array.isArray(context.options)
      ? (context.options[0] ?? {})
      : (context.options ?? {})
    const allowComments = opts.allowComments === true
    return {
      CatchClause(node) {
        const statements = node.body?.body ?? []
        if (statements.length === 0) {
          if (allowComments) {
            const comments = context.sourceCode?.getCommentsInside?.(node) ?? []
            if (comments.length > 0) return
          }
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
    confidence: 'medium',
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
        '命名处理器（.catch(handleError)）无法证明为空，保守不报',
        'promise 链隔离层：catch 后的原 promise 仍暴露给调用方（如 writeQueue.set(id, next.catch(() => {})); return next），错误未被实际吞掉——text-rpg storage.ts 实测误报（T1.19 首例标注，confidence high→medium）'
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

// packages/rules-core/src/rules/no-hardcoded-credentials.js
var no_hardcoded_credentials_default = {
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
    function isCredentialLiteral(value, name) {
      if (
        value?.type !== 'Literal' ||
        typeof value.value !== 'string' ||
        value.value.length < 6
      ) {
        return false
      }
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

// packages/rules-core/src/rules/no-unsafe-regex.js
var no_unsafe_regex_default = {
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

// packages/rules-core/src/rules/no-prototype-pollution-syntax.js
var no_prototype_pollution_syntax_default = {
  meta: {
    category: 'security',
    severity: 'error',
    confidence: 'high',
    typeRequirement: 'none',
    tags: ['cwe-1321', 'owasp-a08'],
    fixable: undefined,
    messages: {
      protoKey:
        'Writing to "__proto__"/"constructor.prototype" pollutes Object.prototype for every object; use Object.defineProperty or a Map. (no-prototype-pollution-syntax)'
    },
    docs: {
      description: '禁止通过字面量/计算键写 __proto__ 与 constructor.prototype',
      rationale:
        '对 __proto__ 或 constructor.prototype 的写入会污染全局对象原型，影响所有对象实例——原型污染攻击的语法面。合并函数的数据流面由 M2 taint 接管（◆）。',
      badExamples: [
        "obj['__proto__'] = payload",
        "ctor['constructor']['prototype'] = payload"
      ],
      goodExamples: [
        'Object.defineProperty(obj, key, { value })',
        'const bag = new Map()'
      ],
      falsePositives: [
        '与内置 no-proto 分工：内置管标识符访问（obj.__proto__），本条管字面量/计算键与合并面'
      ]
    }
  },
  create(context) {
    function report(node) {
      context.report({ node, messageId: 'protoKey' })
    }
    return {
      Property(node) {
        const key = node.key
        const isProtoKey =
          (key?.type === 'Literal' && key.value === '__proto__') ||
          (key?.type === 'Identifier' && key.name === '__proto__')
        if (isProtoKey && node.kind === 'init') report(node)
      },
      MemberExpression(node) {
        if (
          node.computed &&
          node.property?.type === 'Literal' &&
          node.property.value === '__proto__'
        ) {
          report(node)
          return
        }
        const propName =
          node.property?.type === 'Identifier'
            ? node.property.name
            : node.property?.value
        if (propName === 'prototype') {
          const obj = node.object
          if (obj?.type === 'MemberExpression') {
            const objProp =
              obj.property?.type === 'Identifier'
                ? obj.property.name
                : obj.property?.value
            if (objProp === 'constructor') report(node)
          }
        }
      }
    }
  }
}

// packages/rules-core/src/rules/no-child-process-nonliteral.js
var no_child_process_nonliteral_default = {
  meta: {
    category: 'security',
    severity: 'error',
    confidence: 'medium',
    typeRequirement: 'none',
    tags: ['cwe-78', 'owasp-a03'],
    fixable: undefined,
    messages: {
      nonLiteralCommand:
        'child_process command is not a string literal: user-controlled input can enable command injection. (no-child-process-nonliteral)'
    },
    docs: {
      description: '禁止 child_process.exec/execSync 执行非字面量命令',
      rationale:
        '拼接用户输入进 shell 命令是命令注入的直接入口；固定命令 + 白名单参数校验，或用 execFile（不经 shell）。',
      badExamples: ['cp.exec(`ls ${userInput}`)', 'cp.exec(cmd)'],
      goodExamples: ["cp.exec('ls -la', cb)", 'cp.execFile("ls", ["-la"])'],
      falsePositives: [
        '命令确为白名单常量的场景可配 allow；标识符 exec 需来自 child_process 导入才报'
      ]
    }
  },
  create(context) {
    const EXEC_METHODS = new Set(['exec', 'execSync'])
    const imported = new Set()
    function isStaticString(node) {
      if (node?.type === 'Literal' && typeof node.value === 'string')
        return true
      if (node?.type === 'TemplateLiteral') return node.expressions.length === 0
      return false
    }
    function isChildProcessObject(obj) {
      if (obj?.type !== 'Identifier') {
        return (
          obj?.type === 'CallExpression' &&
          obj.callee?.type === 'Identifier' &&
          obj.callee.name === 'require' &&
          obj.arguments?.[0]?.value === 'child_process'
        )
      }
      if (imported.has(obj.name)) return true
      return /child_?process/i.test(obj.name)
    }
    const CHILD_PROCESS_SOURCE = /^(node:)?child_process$/
    return {
      Program(node) {
        for (const stmt of node.body ?? []) {
          if (
            stmt.type === 'ImportDeclaration' &&
            typeof stmt.source?.value === 'string' &&
            CHILD_PROCESS_SOURCE.test(stmt.source.value)
          ) {
            for (const spec of stmt.specifiers ?? []) {
              if (spec.type === 'ImportDefaultSpecifier' && spec.local)
                imported.add(spec.local.name)
              if (
                spec.imported?.type === 'Identifier' &&
                EXEC_METHODS.has(spec.imported.name)
              ) {
                imported.add(spec.local?.name ?? spec.imported.name)
              }
            }
          }
          if (
            stmt.type === 'VariableDeclaration' &&
            stmt.declarations?.[0]?.init?.type === 'CallExpression' &&
            stmt.declarations[0].init.callee?.name === 'require' &&
            typeof stmt.declarations[0].init.arguments?.[0]?.value ===
              'string' &&
            CHILD_PROCESS_SOURCE.test(
              stmt.declarations[0].init.arguments[0].value
            )
          ) {
            const id = stmt.declarations[0].id
            if (id?.type === 'ObjectPattern') {
              for (const prop of id.properties ?? []) {
                const importedName =
                  prop.value?.type === 'Identifier'
                    ? prop.value.name
                    : prop.key?.name
                if (importedName && EXEC_METHODS.has(importedName))
                  imported.add(importedName)
              }
            }
          }
        }
      },
      CallExpression(node) {
        const callee = node.callee
        if (!callee) return
        const arg0 = node.arguments?.[0]
        if (arg0 && isStaticString(arg0)) return
        if (
          callee.type === 'MemberExpression' &&
          callee.property?.type === 'Identifier'
        ) {
          if (
            EXEC_METHODS.has(callee.property.name) &&
            isChildProcessObject(callee.object)
          ) {
            context.report({ node, messageId: 'nonLiteralCommand' })
          }
          return
        }
        if (callee.type === 'Identifier') {
          if (EXEC_METHODS.has(callee.name) && imported.has(callee.name)) {
            context.report({ node, messageId: 'nonLiteralCommand' })
          }
        }
      }
    }
  }
}

// packages/rules-core/src/rules/no-non-literal-fs-filename.js
var no_non_literal_fs_filename_default = {
  meta: {
    category: 'security',
    severity: 'warning',
    confidence: 'low',
    typeRequirement: 'none',
    tags: ['cwe-22', 'owasp-a01'],
    fixable: undefined,
    messages: {
      nonLiteralPath:
        'fs path argument is non-literal: validate/normalize against a base directory to prevent path traversal. (no-non-literal-fs-filename)'
    },
    docs: {
      description: 'fs 文件 API 路径参数为非字面量时提示路径穿越风险',
      rationale:
        '用户可控路径未经规范化即可用 ../ 逃逸基目录。confidence=low：仅报告供复核，禁止进入 CI 门禁。',
      badExamples: ['fs.readFile(userPath, cb)'],
      goodExamples: [
        'fs.readFile("config.json", cb)',
        'fs.readFile(path.join(BASE, safeName), cb)'
      ],
      falsePositives: [
        '命名启发（path/file/dir）与 fs 对象识别都很宽；low confidence 仅供人工复核',
        '内部 fs utility 函数接收路径参数（如 readMdFile(filePath)）——路径来源在调用侧，utility 被逐调用点名（text-rpg 实测 11 条同型噪音；M1.5 候选改进：文件内私有 helper 启发式豁免）'
      ]
    }
  },
  create(context) {
    const FS_FUNCS = new Set([
      'readFile',
      'readFileSync',
      'writeFile',
      'writeFileSync',
      'appendFile',
      'appendFileSync',
      'unlink',
      'unlinkSync',
      'stat',
      'statSync',
      'readdir',
      'readdirSync',
      'access',
      'accessSync',
      'open',
      'openSync'
    ])
    return {
      CallExpression(node) {
        const callee = node.callee
        if (callee?.type !== 'MemberExpression') return
        if (
          callee.property?.type !== 'Identifier' ||
          !FS_FUNCS.has(callee.property.name)
        )
          return
        const obj = callee.object
        const objName =
          obj?.type === 'Identifier'
            ? obj.name
            : obj?.object?.type === 'Identifier'
              ? obj.object.name
              : null
        if (!objName || !/^fs/i.test(objName)) return
        const arg0 = node.arguments?.[0]
        if (!arg0) return
        if (arg0.type === 'Literal' && typeof arg0.value === 'string') return
        if (arg0.type === 'TemplateLiteral' && arg0.expressions.length === 0)
          return
        const named =
          arg0.type === 'Identifier' && /path|file|dir/i.test(arg0.name)
        if (named) {
          context.report({ node, messageId: 'nonLiteralPath' })
        }
      }
    }
  }
}

// packages/rules-core/src/rules/no-non-literal-require.js
var no_non_literal_require_default = {
  meta: {
    category: 'security',
    severity: 'error',
    confidence: 'high',
    typeRequirement: 'none',
    tags: ['cwe-94', 'owasp-a03'],
    fixable: undefined,
    messages: {
      nonLiteralRequire:
        'Module specifier is not a string literal: dynamic require/import can load arbitrary code. (no-non-literal-require)'
    },
    docs: {
      description: '禁止 require()/import() 的模块说明符为非字面量',
      rationale:
        '动态模块说明符让加载的代码不可审计，攻击者可借路径拼接加载恶意模块；动态装配场景应使用显式映射表。',
      badExamples: ['require(moduleName)', 'await import(specifier)'],
      goodExamples: ["require('node:fs')", "await import('./config.json')"],
      falsePositives: [
        '构建器统计的动态导入（如 import.meta.glob）属构建期面，不在此检测'
      ]
    }
  },
  create(context) {
    function isStatic(node) {
      if (node?.type === 'Literal' && typeof node.value === 'string')
        return true
      if (node?.type === 'TemplateLiteral') return node.expressions.length === 0
      return false
    }
    return {
      CallExpression(node) {
        if (
          node.callee?.type !== 'Identifier' ||
          node.callee.name !== 'require'
        )
          return
        const arg0 = node.arguments?.[0]
        if (arg0 && !isStatic(arg0)) {
          context.report({ node, messageId: 'nonLiteralRequire' })
        }
      },
      ImportExpression(node) {
        if (node.source && !isStatic(node.source)) {
          context.report({ node, messageId: 'nonLiteralRequire' })
        }
      }
    }
  }
}

// packages/rules-core/src/rules/no-weak-hash.js
var no_weak_hash_default = {
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

// packages/rules-core/src/rules/no-math-random-secret.js
var no_math_random_secret_default = {
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

// packages/rules-core/src/rules/no-sensitive-storage.js
var no_sensitive_storage_default = {
  meta: {
    category: 'security',
    severity: 'error',
    confidence: 'medium',
    typeRequirement: 'none',
    tags: ['cwe-312', 'owasp-a02'],
    fixable: undefined,
    messages: {
      sensitiveStorage:
        'Storing sensitive data ("{{key}}") in Web Storage exposes it to XSS; use HttpOnly cookies. (no-sensitive-storage)'
    },
    docs: {
      description: '禁止向 localStorage/sessionStorage 写入凭证命名键',
      rationale:
        'Web Storage 可被任意同源脚本读取，XSS 一次即全丢；凭证应走 HttpOnly Cookie。',
      badExamples: ["localStorage.setItem('token', jwt)"],
      goodExamples: ['localStorage.setItem("ui-theme", theme)'],
      falsePositives: [
        '非凭证语义的同名键（如 tokenType）可改命名或行内 ignore'
      ]
    }
  },
  create(context) {
    const SENSITIVE_KEY =
      /(token|secret|jwt|credential|password|passwd|refresh[_-]?token)/i
    return {
      CallExpression(node) {
        const callee = node.callee
        if (
          callee?.type !== 'MemberExpression' ||
          callee.property?.name !== 'setItem'
        )
          return
        const obj = callee.object
        if (
          obj?.type !== 'Identifier' ||
          !/^(local|session)Storage$/.test(obj.name)
        )
          return
        const keyArg = node.arguments?.[0]
        let keyName = null
        if (keyArg?.type === 'Literal' && typeof keyArg.value === 'string')
          keyName = keyArg.value
        else if (keyArg?.type === 'Identifier') keyName = keyArg.name
        if (keyName && SENSITIVE_KEY.test(keyName)) {
          context.report({
            node,
            messageId: 'sensitiveStorage',
            data: { key: keyName }
          })
        }
      }
    }
  }
}

// packages/rules-core/src/rules/no-innerhtml-assignment.js
var no_innerhtml_assignment_default = {
  meta: {
    category: 'security',
    severity: 'error',
    confidence: 'medium',
    typeRequirement: 'none',
    tags: ['cwe-79', 'owasp-a03'],
    fixable: undefined,
    messages: {
      htmlSink:
        'Assigning non-literal content to "{{sink}}" enables XSS; sanitize the input or use textContent. (no-innerhtml-assignment)'
    },
    docs: {
      description: '禁止向 innerHTML/outerHTML/document.write 写入非字面量内容',
      rationale:
        '动态 HTML 注入是 XSS 主入口；纯字面量是静态内容不触发（单 severity，降噪走 allow/ignore）。数据流级检测由 M2 taint 接管（◆）。',
      badExamples: ['el.innerHTML = userInput', 'document.write(userContent)'],
      goodExamples: [
        "el.innerHTML = '<b>static</b>'",
        'el.textContent = userInput'
      ],
      falsePositives: [
        '右值已过 DOMPurify 等净化器的场景（taint 版可识别 sanitizer）'
      ]
    }
  },
  create(context) {
    function isStaticHtml(node) {
      if (node?.type === 'Literal' && typeof node.value === 'string')
        return true
      if (node?.type === 'TemplateLiteral') return node.expressions.length === 0
      return false
    }
    const SINKS = new Set(['innerHTML', 'outerHTML'])
    return {
      AssignmentExpression(node) {
        const target = node.left
        if (
          target?.type === 'MemberExpression' &&
          target.property?.type === 'Identifier' &&
          SINKS.has(target.property.name)
        ) {
          if (!isStaticHtml(node.right)) {
            context.report({
              node,
              messageId: 'htmlSink',
              data: { sink: target.property.name }
            })
          }
        }
      },
      CallExpression(node) {
        const callee = node.callee
        if (
          callee?.type === 'MemberExpression' &&
          callee.object?.type === 'Identifier' &&
          callee.object.name === 'document' &&
          callee.property?.type === 'Identifier' &&
          (callee.property.name === 'write' ||
            callee.property.name === 'writeln')
        ) {
          const arg0 = node.arguments?.[0]
          if (arg0 && !isStaticHtml(arg0)) {
            context.report({
              node,
              messageId: 'htmlSink',
              data: { sink: `document.${callee.property.name}` }
            })
          }
        }
      }
    }
  }
}

// packages/rules-core/src/rules/no-sql-concat.js
var no_sql_concat_default = {
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

// packages/rules-core/src/rules/no-cors-wildcard.js
var no_cors_wildcard_default = {
  meta: {
    category: 'security',
    severity: 'warning',
    confidence: 'high',
    typeRequirement: 'none',
    tags: ['cwe-942', 'owasp-a05'],
    fixable: undefined,
    messages: {
      corsWildcard:
        'CORS policy allows any origin ("*" / reflect-all): restrict to an explicit origin allowlist. (no-cors-wildcard)'
    },
    docs: {
      description:
        '禁止 CORS 通配来源（Access-Control-Allow-Origin: * 或 cors origin:true）',
      rationale:
        '通配/反射任意来源使跨站请求可携带凭证读取响应，扩大 XSS/CSRF 影响面；应配置显式白名单。',
      badExamples: [
        "res.setHeader('Access-Control-Allow-Origin', '*')",
        'cors({ origin: true })'
      ],
      goodExamples: [
        "res.setHeader('Access-Control-Allow-Origin', 'https://app.example.com')"
      ],
      falsePositives: ['纯公开只读 API 的通配可配 allow']
    }
  },
  create(context) {
    const HEADER = 'access-control-allow-origin'
    return {
      CallExpression(node) {
        const callee = node.callee
        if (
          callee?.type === 'MemberExpression' &&
          callee.property?.type === 'Identifier' &&
          callee.property.name === 'setHeader'
        ) {
          const name = node.arguments?.[0]
          const value = node.arguments?.[1]
          if (
            name?.type === 'Literal' &&
            typeof name.value === 'string' &&
            name.value.toLowerCase() === HEADER
          ) {
            if (value?.type === 'Literal' && value.value === '*') {
              context.report({ node, messageId: 'corsWildcard' })
            }
          }
          return
        }
        const corsName =
          callee?.type === 'Identifier'
            ? callee.name
            : callee?.type === 'MemberExpression'
              ? callee.property?.name
              : null
        if (corsName === 'cors') {
          const arg0 = node.arguments?.[0]
          if (arg0?.type === 'ObjectExpression') {
            for (const prop of arg0.properties ?? []) {
              const key =
                prop.key?.type === 'Identifier'
                  ? prop.key.name
                  : prop.key?.value
              if (key !== 'origin') continue
              const v = prop.value
              if (
                (v?.type === 'Literal' && v.value === '*') ||
                (v?.type === 'Literal' && v.value === true)
              ) {
                context.report({ node, messageId: 'corsWildcard' })
              }
            }
          }
        }
      },
      Property(node) {
        const key =
          node.key?.type === 'Literal' ? node.key.value : node.key?.name
        if (
          typeof key === 'string' &&
          key.toLowerCase() === HEADER &&
          node.value?.type === 'Literal' &&
          node.value.value === '*'
        ) {
          context.report({ node, messageId: 'corsWildcard' })
        }
      }
    }
  }
}

// packages/rules-core/src/rules/no-vm-dynamic-code.js
var no_vm_dynamic_code_default = {
  meta: {
    category: 'security',
    severity: 'error',
    confidence: 'medium',
    typeRequirement: 'none',
    tags: ['cwe-94', 'owasp-a03'],
    fixable: undefined,
    messages: {
      vmDynamicCode:
        '"{{name}}" executes a non-literal script: arbitrary code execution risk. (no-vm-dynamic-code)'
    },
    docs: {
      description: '禁止 vm.runInContext 系执行非字面量脚本',
      rationale:
        '动态脚本执行 = 任意代码执行；new Function 已由映射清单 no-new-func 覆盖，本条管 vm 模块的 run 系列。',
      badExamples: ['vm.runInContext(userCode, ctx)'],
      goodExamples: ["vm.runInContext('1 + 1', ctx)"],
      falsePositives: ['沙箱内运行可信静态脚本的场景可配 allow']
    }
  },
  create(context) {
    const RUN_METHODS = new Set([
      'runInContext',
      'runInNewContext',
      'runInThisContext'
    ])
    function isVmObject(obj) {
      if (obj?.type === 'Identifier')
        return /vm$/i.test(obj.name) || obj.name === 'nodeVm'
      if (
        obj?.type === 'CallExpression' &&
        obj.callee?.type === 'Identifier' &&
        obj.callee.name === 'require'
      ) {
        return /(^|[:/])vm$/.test(String(obj.arguments?.[0]?.value ?? ''))
      }
      return false
    }
    return {
      CallExpression(node) {
        const callee = node.callee
        if (callee?.type !== 'MemberExpression') return
        if (
          callee.property?.type !== 'Identifier' ||
          !RUN_METHODS.has(callee.property.name)
        )
          return
        if (!isVmObject(callee.object)) return
        const arg0 = node.arguments?.[0]
        if (arg0?.type === 'Literal' && typeof arg0.value === 'string') return
        if (arg0?.type === 'TemplateLiteral' && arg0.expressions.length === 0)
          return
        context.report({
          node,
          messageId: 'vmDynamicCode',
          data: { name: callee.property.name }
        })
      }
    }
  }
}

// packages/rules-core/src/rules/no-insecure-cookie.js
var no_insecure_cookie_default = {
  meta: {
    category: 'security',
    severity: 'warning',
    confidence: 'medium',
    typeRequirement: 'none',
    tags: ['cwe-614', 'cwe-1004', 'owasp-a05'],
    fixable: undefined,
    messages: {
      insecureCookie:
        'Cookie is set without HttpOnly/Secure: it is readable by scripts and sent over plain HTTP. (no-insecure-cookie)'
    },
    docs: {
      description: 'Set-Cookie 缺少 HttpOnly/Secure 标志',
      rationale:
        '缺 HttpOnly 可被脚本读取（XSS 窃取会话），缺 Secure 会经明文传输。与内置 unicorn/no-document-cookie 分工：内置管 document.cookie 赋值，本条管 Set-Cookie 字符串与框架 cookie 选项。',
      badExamples: [
        "res.setHeader('Set-Cookie', 'sid=1; Path=/')",
        "res.cookie('sid', id)"
      ],
      goodExamples: [
        "res.setHeader('Set-Cookie', 'sid=1; HttpOnly; Secure')",
        "res.cookie('sid', id, { httpOnly: true, secure: true })"
      ],
      falsePositives: [
        '非会话类 cookie（统计）可配 allow；非 express 系框架选项面逐步扩展'
      ]
    }
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee
        if (
          callee?.type !== 'MemberExpression' ||
          callee.property?.type !== 'Identifier'
        )
          return
        if (callee.property.name === 'setHeader') {
          const name = node.arguments?.[0]
          const value = node.arguments?.[1]
          if (
            name?.type === 'Literal' &&
            /set-cookie/i.test(String(name.value))
          ) {
            const cookie = String(value?.value ?? '')
            if (!/httponly/i.test(cookie) || !/secure/i.test(cookie)) {
              context.report({ node, messageId: 'insecureCookie' })
            }
          }
          return
        }
        if (callee.property.name === 'cookie') {
          const options = node.arguments?.[2]
          if (options?.type !== 'ObjectExpression') {
            context.report({ node, messageId: 'insecureCookie' })
            return
          }
          let httpOnly = false
          let secure = false
          for (const prop of options.properties ?? []) {
            const key =
              prop.key?.type === 'Identifier' ? prop.key.name : prop.key?.value
            if (key === 'httpOnly' && prop.value?.value === true)
              httpOnly = true
            if (key === 'secure' && prop.value?.value === true) secure = true
          }
          if (!httpOnly || !secure) {
            context.report({ node, messageId: 'insecureCookie' })
          }
        }
      }
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
    'no-sync-io-in-async': no_sync_io_in_async_default,
    'no-hardcoded-credentials': no_hardcoded_credentials_default,
    'no-unsafe-regex': no_unsafe_regex_default,
    'no-prototype-pollution-syntax': no_prototype_pollution_syntax_default,
    'no-child-process-nonliteral': no_child_process_nonliteral_default,
    'no-non-literal-fs-filename': no_non_literal_fs_filename_default,
    'no-non-literal-require': no_non_literal_require_default,
    'no-weak-hash': no_weak_hash_default,
    'no-math-random-secret': no_math_random_secret_default,
    'no-sensitive-storage': no_sensitive_storage_default,
    'no-innerhtml-assignment': no_innerhtml_assignment_default,
    'no-sql-concat': no_sql_concat_default,
    'no-cors-wildcard': no_cors_wildcard_default,
    'no-vm-dynamic-code': no_vm_dynamic_code_default,
    'no-insecure-cookie': no_insecure_cookie_default
  }
}
export { src_default as default }
