// @ts-nocheck invalid-3：标识符键名命中（STORED_JWT）
const STORED_JWT = 'auth-cache'

export function cache(value: string) {
  localStorage.setItem(STORED_JWT, value)
}
