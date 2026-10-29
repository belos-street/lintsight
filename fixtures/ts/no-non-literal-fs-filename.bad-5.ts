// @ts-nocheck invalid-5：path.join 参数含外部输入 → 不豁免
import fs from 'node:fs'
import path from 'node:path'

export function readUser(name: string) {
  const filePath = path.join(process.cwd(), name)
  return fs.readFileSync(filePath, 'utf8')
}
