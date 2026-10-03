import { isTestFile } from '../is-test-file.js'

/**
 * no-sensitive-storage —— P0 安全（v0.1① #9，CWE-312 / OWASP A02）。
 * 选项（M2.7）：testFiles='exempt'（默认）测试文件豁免；'report' 恢复全量报告。
 * 测试文件判定见 is-test-file.js。
 */
export default {
  meta: {
    category: 'security',
    severity: 'error',
    confidence: 'medium',
    typeRequirement: 'none',
    tags: ['cwe-312', 'owasp-a02'],
    fixable: undefined,
    schema: [
      {
        type: 'object',
        properties: {
          testFiles: { type: 'string', enum: ['exempt', 'report'] }
        },
        additionalProperties: false
      }
    ],
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
        '非凭证语义的同名键（如 tokenType）可改命名或行内 ignore',
        "测试文件（*.test.* / *.spec.* / test(s)/ / __tests__/）默认豁免，options 传 { testFiles: 'report' } 恢复报告"
      ]
    }
  },
  create(context) {
    // 选项（M2.7）：测试文件默认豁免（context.filename 为绝对路径字符串，判定见 is-test-file.js）；
    // context.options 兼容 ESLint 形态（数组），同 no-empty-catch
    const opts = Array.isArray(context.options)
      ? (context.options[0] ?? {})
      : (context.options ?? {})
    const policy = opts.testFiles ?? 'exempt'
    const testFile = isTestFile(context.filename)
    // create 顶部提前返回：豁免时零 visitor 注册，逐 visitor 判断零成本
    if (testFile && policy === 'exempt') return {}

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
