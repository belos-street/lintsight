// @ts-nocheck invalid-1：forEach + async 回调（返回 Promise 被忽略，异常不冒泡）
export async function syncEach(ids: string[]) {
  ids.forEach(async (id) => {
    await fetch(`/api/${id}`)
  })
  return ids.length
}
