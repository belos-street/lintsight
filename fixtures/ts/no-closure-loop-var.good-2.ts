// @ts-nocheck valid-2：var 声明但循环内无闭包捕获（直接使用）
export function sum(items: number[]) {
  let total = 0
  for (var i = 0; i < items.length; i++) {
    total += items[i]
  }
  return total
}
