/** no-vm-dynamic-code —— P0 安全（v0.1① #13，CWE-94 / OWASP A03）。 */
export default {
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
