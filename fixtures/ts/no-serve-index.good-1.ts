// @ts-nocheck safe-1：只按文件名提供下载（无目录列表）——安全替代写法
app.use('/ftp/:file', servePublicFiles())
