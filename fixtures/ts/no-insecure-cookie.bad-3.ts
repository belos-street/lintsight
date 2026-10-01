// @ts-nocheck invalid-3：有 httpOnly 缺 secure
export function setSid2(res: { cookie(n: string, v: string, o?: object): void }, id: string) {
  res.cookie('sid', id, { httpOnly: true })
}
