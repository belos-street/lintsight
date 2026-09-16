// invalid-2：嵌套在表达式中的克隆模式
export function snapshot(state: unknown) {
  localStorage.setItem('snap', JSON.stringify(JSON.parse(JSON.stringify(state))))
}
