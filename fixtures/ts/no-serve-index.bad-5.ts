// @ts-nocheck invalid-5：require 别名形态（绑定名非 serveIndex）
const idx = require('serve-index')
app.use('/files', idx('files'))
