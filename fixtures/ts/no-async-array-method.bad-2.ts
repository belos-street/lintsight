// invalid-2：map + async 回调（结果是 Promise 数组而非数据）
export function wrongMap(ids: string[]) {
  return ids.map(async (id) => {
    const r = await fetch(`/api/${id}`)
    return r.status
  })
}
