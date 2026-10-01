// @ts-nocheck invalid-1：localStorage 存储 token
export function saveSession(jwt: string) {
  localStorage.setItem('token', jwt)
}
