// valid-1：并发收集的安全替代写法（Promise.all + 同步回调返回 Promise）
export async function collect(ids: string[]) {
  const results = await Promise.all(ids.map((id) => fetch(`/api/${id}`)))
  return results.length
}
