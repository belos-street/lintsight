// invalid-2：模板字符串拼接模块路径
export function loadPlugin(name: string) {
  const plugin = require(`./plugins/${name}`)
  return plugin
}
