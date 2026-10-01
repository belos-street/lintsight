// @ts-nocheck invalid-1：setHeader 通配来源
export function enableAll(res: { setHeader(k: string, v: string): void }) {
  res.setHeader('Access-Control-Allow-Origin', '*')
}
