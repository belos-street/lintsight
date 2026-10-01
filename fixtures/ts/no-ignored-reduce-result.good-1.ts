// @ts-nocheck valid-1：reduce 结果被接收
export function sum(items: number[]) {
  return items.reduce((acc, n) => acc + n, 0)
}
