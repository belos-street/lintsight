// @ts-nocheck invalid-2：reduceRight 语句
export function touchRight(items: number[]) {
  items.reduceRight((acc, n) => acc + n)
}
