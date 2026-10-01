// @ts-nocheck invalid-3：for-in + var + 箭头函数捕获
export function printKeys(map: Record<string, number>) {
  for (var key in map) {
    const render = () => `key: ${key}`
    setTimeout(render, 10)
  }
}
