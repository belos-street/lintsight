// @ts-nocheck valid-1：正常解析外部 JSON 文本
export function parsePayload(raw: string) {
  return JSON.parse(raw)
}
