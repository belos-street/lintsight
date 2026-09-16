/** no-child-process-nonliteral —— P0 安全（v0.1① #4，CWE-78 / OWASP A03）。 */
export default {
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
    // ⚠️ oxlint 嵌入式 runtime 的 context 是冻结对象——规则状态必须放 create 闭包，禁止挂到 context 上
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
      // 默认导入名（import cp from 'child_process'）或直觉名
      if (imported.has(obj.name)) return true
      return /child_?process/i.test(obj.name)
    }

    const CHILD_PROCESS_SOURCE = /^(node:)?child_process$/

    return {
      Program(node) {
        // 预扫描：记录从 child_process 导入/解构的方法名（exec/execSync）与默认导入名
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
          // const { exec, execSync: run } = require('child_process')
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

        // 成员形式：cp.exec(...) / require('child_process').execSync(...)
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
        // 解构导入的标识符形式：exec(...)
        if (callee.type === 'Identifier') {
          if (EXEC_METHODS.has(callee.name) && imported.has(callee.name)) {
            context.report({ node, messageId: 'nonLiteralCommand' })
          }
        }
      }
    }
  }
}
