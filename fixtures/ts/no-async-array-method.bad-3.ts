// invalid-3：reduce + async 回调（聚合值是 Promise），方法调用换行变体
export function badReduce(total: number, ids: string[]) {
  return ids
    .reduce(async (acc, id) => {
      await fetch(`/api/${id}`)
      return acc
    }, total)
}
