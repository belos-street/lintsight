/**
 * no-serve-index —— M3 召回扩充（FR-303 安全面，CWE-548 / OWASP A05）。
 * serve-index/serveIndex 挂载目录浏览：暴露文件名、大小、时间戳，
 * 攻击者可枚举敏感文件（juice-shop accessLog/directoryListing 埋洞形态）。
 * 纯语法：任何 serveIndex 调用即报（目录浏览本身是暴露面，无安全配置项）。
 * 检测面（M3 review 发现 ④ 补齐）：serveIndex(...) / .serveIndex(...) /
 * require('serve-index') 立即调用 / require('serve-index') 别名调用。
 * v0 边界：别名再赋值（const f = serveIndex; f()）与动态 import 不追踪。
 */
export default {
  meta: {
    category: 'security',
    severity: 'warning',
    confidence: 'high',
    typeRequirement: 'none',
    tags: ['cwe-548', 'owasp-a05'],
    fixable: undefined,
    messages: {
      serveIndex:
        'Serving a directory listing with serveIndex exposes file names and metadata; serve only the needed files explicitly. (no-serve-index)'
    },
    docs: {
      description:
        '禁止用 serveIndex/serve-index 开启目录浏览（文件名/元数据暴露）',
      rationale:
        '目录浏览是信息暴露面（CWE-548）：暴露文件名、大小、修改时间供攻击者枚举；应仅按已知文件名提供下载（:file 路由）。',
      badExamples: [
        "app.use('/ftp', serveIndex('ftp'))",
        "app.use('/logs', serveIndex('logs', { icons: true }))"
      ],
      goodExamples: [
        "app.use('/ftp/:file', servePublicFiles())",
        "app.use('/assets', express.static('assets'))"
      ],
      falsePositives: [
        '内网管理后台有意开启目录浏览的场景（安全评审后可配 ignore）'
      ]
    }
  },
  create(context) {
    // require('serve-index') 绑定名（`const idx = require('serve-index')`）——
    // 标识符名非 serveIndex 的别名形态（M3 review 发现 ④ 漏报面）
    const serveIndexAliases = new Set()
    const isServeIndexRequire = (expr) =>
      expr?.type === 'CallExpression' &&
      expr.callee?.type === 'Identifier' &&
      expr.callee.name === 'require' &&
      expr.arguments?.length > 0 &&
      expr.arguments[0]?.type === 'Literal' &&
      expr.arguments[0].value === 'serve-index'
    return {
      VariableDeclarator(node) {
        if (node.id?.type === 'Identifier' && isServeIndexRequire(node.init)) {
          serveIndexAliases.add(node.id.name)
        }
      },
      CallExpression(node) {
        const callee = node.callee
        // require('serve-index')('ftp') 立即调用
        if (isServeIndexRequire(callee)) {
          context.report({ node, messageId: 'serveIndex' })
          return
        }
        // 裸标识符 serveIndex(...) / 成员 .serveIndex(...) / require 别名(...)
        const name =
          callee?.type === 'Identifier'
            ? callee.name
            : callee?.type === 'MemberExpression' &&
                callee.property?.type === 'Identifier'
              ? callee.property.name
              : null
        if (
          name === 'serveIndex' ||
          (callee?.type === 'Identifier' && serveIndexAliases.has(callee.name))
        ) {
          context.report({ node, messageId: 'serveIndex' })
        }
      }
    }
  }
}
