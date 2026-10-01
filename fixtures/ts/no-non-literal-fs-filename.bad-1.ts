// @ts-nocheck invalid-1：fs.readFile 路径参数为非字面量（path/file/dir 命名启发）
import fs from 'node:fs'

export function load(filePath: string, cb: (e: unknown, d: unknown) => void) {
  fs.readFile(filePath, cb)
}
