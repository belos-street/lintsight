// @ts-nocheck invalid-4：私有函数内但路径为局部变量（非参数）→ 仍报（豁免仅限函数参数）
import fs from 'node:fs'

function loadFromUser() {
  const userPath = resolveUserPath()
  return fs.readFileSync(userPath, 'utf8')
}

// TS 名称解析辅助（声明提升，契约行为行 1~7 不变；无 fs 调用，不新增诊断面）
function resolveUserPath(): string {
  return process.argv[2] ?? './upload.bin'
}
