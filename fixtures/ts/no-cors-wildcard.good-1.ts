// @ts-nocheck valid-1：显式白名单来源
export function enableWhitelist(res: { setHeader(k: string, v: string): void }) {
  res.setHeader('Access-Control-Allow-Origin', 'https://app.example.com')
}
