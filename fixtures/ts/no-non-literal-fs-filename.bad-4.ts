// invalid-4：私有函数内但路径为局部变量（非参数）→ 仍报（豁免仅限函数参数）
import fs from 'node:fs'

function loadFromUser() {
  const userPath = resolveUserPath()
  return fs.readFileSync(userPath, 'utf8')
}
