// @ts-nocheck valid-1：await / void / return 都是已处理形态
export async function handler2(id: string) {
  await save(id)
  void maybeSync()
  return Promise.resolve(1)
}

async function save(id: string) {
  await fetch(`/api/${id}`)
}

function maybeSync() {}
