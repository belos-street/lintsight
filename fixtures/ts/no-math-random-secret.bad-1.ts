// invalid-1：Math.random 直接赋给 token 命名变量
export function issueToken() {
  const token = Math.random()
  return token
}
