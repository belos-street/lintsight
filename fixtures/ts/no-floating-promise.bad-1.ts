// @ts-nocheck invalid-1：同文件 async 函数调用未 await（声明在调用后，预扫描兜底）
export function handler(id: string) {
  save(id)
}

async function save(id: string) {
  await fetch(`/api/${id}`)
}
