// @ts-nocheck invalid-3：链式 reduce 语句（缩进变体）
export function touchChain(items: number[][]) {
  items
    .flat()
    .reduce((acc, n) => acc + n, 0)
}
