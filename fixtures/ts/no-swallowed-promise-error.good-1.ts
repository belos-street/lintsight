// @ts-nocheck valid-1：引用了错误参数
export function load3(raw: string) {
  try {
    return JSON.parse(raw)
  } catch (e) {
    console.error('parse failed', e)
    return null
  }
}
