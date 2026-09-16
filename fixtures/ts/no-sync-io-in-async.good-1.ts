// valid-1：async 内使用 promises API
import { readFile } from 'node:fs/promises'

export async function loadConfig2(path: string) {
  return readFile(path, 'utf8')
}
