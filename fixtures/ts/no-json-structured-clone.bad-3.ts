// invalid-3：赋值形态的克隆
export function copy(state: { id: number }) {
  const cloned = JSON.parse(JSON.stringify(state))
  return cloned
}
