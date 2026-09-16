// valid-2：安全替代写法（crypto.randomUUID）
export function issueToken2() {
  return crypto.randomUUID()
}
