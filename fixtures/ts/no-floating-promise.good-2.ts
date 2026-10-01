// @ts-nocheck valid-2：赋值保存与 .catch 终结不误伤
export function handler3() {
  const p = Promise.resolve(1).then((v) => v + 1)
  flushAsync().catch((e) => console.error(e))
  return p
}
