// valid-2：非 async 函数中的同步 IO 不归本条
import { readFileSync } from 'node:fs'

export function loadSync(path: string) {
  return readFileSync(path, 'utf8')
}
