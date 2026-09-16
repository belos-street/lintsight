// invalid-3：成员赋值形态
export function applyDbConfig(db: { password: string }) {
  db.password = 'sup3r-s3cret-value'
}
