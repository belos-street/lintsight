// @ts-nocheck G12 preset：low confidence 安全规则（security 预设提升为 error）
import fs from 'node:fs'

export function load(filePath: string, cb: (e: unknown, d: unknown) => void) {
  fs.readFile(filePath, cb)
}
