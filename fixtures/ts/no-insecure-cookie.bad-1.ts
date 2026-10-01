// @ts-nocheck invalid-1：Set-Cookie 缺 HttpOnly/Secure
export function setSession(res: { setHeader(k: string, v: string): void }) {
  res.setHeader('Set-Cookie', 'session=abc; Path=/')
}
