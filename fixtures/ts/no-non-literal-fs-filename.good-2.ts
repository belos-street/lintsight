// valid-2：非 fs 对象与字面量路径均不触发
import fs from 'node:fs'

export function examples(db: { readFile(id: string): unknown }, knownFile: string) {
  db.readFile(knownFile)
  return fs.readFile('known.txt', () => {})
}
