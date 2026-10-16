// @ts-nocheck invalid-2：中间件链 + details 视图（juice-shop directoryListing 形态）
app.use('/ftp', serveIndexMiddleware, serveIndex('ftp', { icons: true, view: 'details' }))
