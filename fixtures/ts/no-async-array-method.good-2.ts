// valid-2：同步回调不触发；for-of 内 await 是正确写法；字符串与注释中的方法名干扰
export async function okEach(ids: string[]) {
  const note = 'never call forEach with async callbacks'
  for (const id of ids) {
    await fetch(`/api/${id}`)
  }
  return note
}
