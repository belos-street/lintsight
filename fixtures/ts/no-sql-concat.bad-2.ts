// invalid-2：字符串 + 拼接进查询
export function findByName(name: string) {
  const q = 'SELECT * FROM users WHERE name = ' + name
  return q
}
