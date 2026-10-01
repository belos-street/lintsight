// @ts-nocheck valid-3：Promise.all 消费 async map 回调是标准写法（豁免）
export async function fetchAll(ids: string[]) {
  const results = await Promise.all(
    ids.map(async (id) => {
      const r = await fetch(`/api/${id}`)
      return r.status
    })
  )
  return results
}
