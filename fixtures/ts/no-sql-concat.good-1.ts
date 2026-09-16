// valid-1：参数占位符写法（字面量无插值）
export function findUserById(id: string, db: { query(q: string, args: unknown[]): unknown }) {
  return db.query('SELECT * FROM users WHERE id = ?', [id])
}
