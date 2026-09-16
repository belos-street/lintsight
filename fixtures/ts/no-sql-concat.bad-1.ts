// invalid-1：模板字符串以 SELECT 开头且含插值
export function findUser(id: string) {
  const q = `SELECT * FROM users WHERE id = ${id}`
  return q
}
