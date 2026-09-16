// invalid-2：fs.writeFileSync 成员形式
import fs from 'node:fs'

export async function persist(path: string, data: string) {
  fs.writeFileSync(path, data)
}
