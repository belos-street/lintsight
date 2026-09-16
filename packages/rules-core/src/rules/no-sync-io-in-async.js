/** no-sync-io-in-async —— P0 正确性（v0.1① #11，原 stretch 转正）。 */
export default {
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
        return // 嵌套函数归其自身语境
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
