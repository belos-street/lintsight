// @ts-nocheck invalid-3：多语句均未引用错误参数
export function track(raw: string) {
  try {
    JSON.parse(raw)
  } catch (error) {
    stats.increment('parse_error')
    return undefined
  }
}
