// invalid-3：成员赋值形态（nonce 命名）
export function makeSession(session: { nonce: number }) {
  session.nonce = Math.random()
  return session
}
