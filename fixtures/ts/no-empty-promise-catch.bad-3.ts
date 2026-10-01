// @ts-nocheck invalid-3：空函数表达式回调
export function load3(url: string) {
  return fetch(url).catch(function () {})
}
