/** no-non-literal-fs-filename —— P0 安全（v0.1① #5，CWE-22 / OWASP A01，low 禁入门禁）。 */
export default {
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
        '未导出 helper 的路径参数不点名（如 readMdFile(filePath)）——参数来源在调用侧，语法级无法判定，跨模块审计归调用方/M2 taint（text-rpg 实测 11 条同型噪音，T1.19 #1 反哺转正）；导出函数的参数仍报'
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

    // 函数参数栈（T1.19 #1 反哺）：未导出函数的参数标识符豁免——
    // 参数来源在调用侧，私有 helper 内部点名只是噪音；导出函数（模块边界 API）仍报。
    // 栈式结构正确处理嵌套函数与参数遮蔽。
    const fnStack = []

    const collectParamNames = (params) => {
      const names = new Set()
      for (const p of params ?? []) {
        if (p?.type === 'Identifier') names.add(p.name)
        else if (
          p?.type === 'AssignmentPattern' &&
          p.left?.type === 'Identifier'
        )
          names.add(p.left.name)
        else if (p?.type === 'RestElement' && p.argument?.type === 'Identifier')
          names.add(p.argument.name)
      }
      return names
    }
    const isExported = (node) => {
      let cur = node.parent
      for (let depth = 0; cur && depth < 4; depth++) {
        if (
          cur.type === 'ExportNamedDeclaration' ||
          cur.type === 'ExportDefaultDeclaration'
        )
          return true
        cur = cur.parent
      }
      return false
    }
    const enterFn = (node) => {
      fnStack.push({
        paramNames: collectParamNames(node.params),
        exported: isExported(node)
      })
    }
    const exitFn = () => fnStack.pop()
    // arg0 是某层函数的参数时，取定义它的最近一帧：私有 → 豁免，导出 → 仍报
    const isParamOfPrivateFn = (arg0) => {
      if (arg0?.type !== 'Identifier') return false
      for (let i = fnStack.length - 1; i >= 0; i--) {
        const frame = fnStack[i]
        if (frame.paramNames.has(arg0.name)) return !frame.exported
      }
      return false
    }

    return {
      // ⚠️ oxlint 嵌入式 runtime 实测不支持 { enter, exit } 对象形态 visitor，
      // 只认函数值 / ':exit' 后缀键——ESLint 标准的兼容缺口（1.83.0 实测）
      FunctionDeclaration: enterFn,
      'FunctionDeclaration:exit': exitFn,
      FunctionExpression: enterFn,
      'FunctionExpression:exit': exitFn,
      ArrowFunctionExpression: enterFn,
      'ArrowFunctionExpression:exit': exitFn,
      CallExpression(node) {
        const callee = node.callee
        if (callee?.type !== 'MemberExpression') return
        if (
          callee.property?.type !== 'Identifier' ||
          !FS_FUNCS.has(callee.property.name)
        )
          return
        // 对象需形如 fs / fsp / fsPromises
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
        // 收窄启发：路径参数标识符名含 path/file/dir 才报
        const named =
          arg0.type === 'Identifier' && /path|file|dir/i.test(arg0.name)
        if (named) {
          if (isParamOfPrivateFn(arg0)) return // 未导出函数的参数 → 豁免（T1.19 #1）
          context.report({ node, messageId: 'nonLiteralPath' })
        }
      }
    }
  }
}
