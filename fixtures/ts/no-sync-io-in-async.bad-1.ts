// invalid-1：async 函数内的 readFileSync（标识符形式）
import { readFileSync } from 'node:fs'

export async function loadConfig(path: string) {
  return readFileSync(path, 'utf8')
}
