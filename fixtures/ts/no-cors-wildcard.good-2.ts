// valid-2：来源来自配置变量 + 显式白名单 cors
import cors from 'cors'

export function build(allowOrigin: string) {
  const headers = { 'Access-Control-Allow-Origin': allowOrigin }
  const middleware = cors({ origin: 'https://app.example.com' })
  return { headers, middleware }
}
