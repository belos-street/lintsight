// invalid-2：res.cookie 无选项对象（两个标志全缺）
export function setSid(res: { cookie(n: string, v: string, o?: object): void }, id: string) {
  res.cookie('sid', id)
}
