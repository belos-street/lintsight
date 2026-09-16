// invalid-3：INSERT 模板插值
export function log(entry: string) {
  const q = `INSERT INTO logs VALUES (${entry})`
  return q
}
