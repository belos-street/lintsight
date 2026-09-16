// invalid-2：runInNewContext 参数来自请求
export function runFromRequest(code: string) {
  return require('node:vm').runInNewContext(code, {})
}
