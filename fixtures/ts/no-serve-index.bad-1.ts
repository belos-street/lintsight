// @ts-nocheck invalid-1：serveIndex 暴露目录浏览（juice-shop accessLog 形态）
app.use('/support/logs', serveIndex('logs', { icons: true }))
