// valid-2：赋值使用
export function totalOf(items: number[]) {
  let total = 0
  total = items.reduce((acc, n) => acc + n, total)
  return total
}
