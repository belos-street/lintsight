// valid-1：Set-Cookie 同时带 HttpOnly 与 Secure
export function setSession2(res: { setHeader(k: string, v: string): void }) {
  res.setHeader('Set-Cookie', 'session=abc; HttpOnly; Secure; Path=/')
}
