// valid-1：字面量路径
import fs from 'node:fs'

export function loadKnown() {
  return fs.readFileSync('config.json', 'utf8')
}
