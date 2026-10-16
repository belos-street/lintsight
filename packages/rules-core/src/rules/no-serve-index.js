/**
 * no-serve-index —— M3 召回扩充（FR-303 安全面，CWE-548 / OWASP A05）。
 * serve-index/serveIndex 挂载目录浏览：暴露文件名、大小、时间戳，
 * 攻击者可枚举敏感文件（juice-shop accessLog/directoryListing 埋洞形态）。
 * 纯语法：任何 serveIndex 调用即报（目录浏览本身是暴露面，无安全配置项）。
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
    return {
      CallExpression(node) {
        const callee = node.callee
        // 裸标识符 serveIndex(...) / 成员 .serveIndex(...)
        const name =
          callee?.type === 'Identifier'
            ? callee.name
            : callee?.type === 'MemberExpression' &&
                callee.property?.type === 'Identifier'
              ? callee.property.name
              : null
        if (name === 'serveIndex') {
          context.report({ node, messageId: 'serveIndex' })
        }
      }
    }
  }
}
