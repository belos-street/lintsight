// @ts-nocheck invalid-1：catch 参数未引用且无 rethrow（console 不带 e）
export function load(raw: string) {
  try {
    return JSON.parse(raw)
  } catch (e) {
    console.error('parse failed')
  }
}
