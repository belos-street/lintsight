// @ts-nocheck invalid-2：块体回调有 return，结果被丢弃
export function transform(items: number[]) {
  items.map((n) => {
    const doubled = n * 2
    return doubled
  })
}
