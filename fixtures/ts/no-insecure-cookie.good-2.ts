// @ts-nocheck valid-2：选项对象两个标志齐全
export function setSid3(res: { cookie(n: string, v: string, o?: object): void }, id: string) {
  res.cookie('sid', id, { httpOnly: true, secure: true, sameSite: 'strict' })
}
