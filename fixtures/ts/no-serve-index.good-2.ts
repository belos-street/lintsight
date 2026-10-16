// @ts-nocheck safe-2：静态资源服务（express.static 不列举目录）——不触发
app.use('/assets', express.static('assets'))
