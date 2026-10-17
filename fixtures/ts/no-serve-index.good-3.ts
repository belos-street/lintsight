// @ts-nocheck safe-3：其他模块 require 不进别名表（别名跟踪仅限 serve-index）
const serveStatic = require('serve-static')
app.use('/assets', serveStatic('assets'))
