// invalid-3：嵌套块中的 existsSync（两处均触发）
import { existsSync } from 'node:fs'

export async function ensure(path: string) {
  if (!existsSync(path)) {
    existsSync(`${path}.bak`)
  }
}
