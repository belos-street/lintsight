// @ts-nocheck valid-4：路径常量由 path.join(process.cwd(), 字面量) 派生 → 无外部输入
import fs from 'node:fs'
import path from 'node:path'

const packageJsonPath = path.join(process.cwd(), 'package.json')

export function readPackage() {
  return fs.readFileSync(packageJsonPath, 'utf8')
}

const distPath = path.join(process.cwd(), 'dist')

export function listDist() {
  return fs.readdirSync(distPath)
}
