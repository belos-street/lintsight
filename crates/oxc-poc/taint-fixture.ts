// spike ⑤ taint 预演用例：三个场景对应传播模型的三条验证线
import fs from 'node:fs'
import path from 'node:path'

// case 1：参数 source → path.join 传播 → sink 命中
export function loadSave(savesDir: string, file: string): string {
  const filePath = path.join(savesDir, file)
  return fs.readFileSync(filePath, 'utf8')
}

// case 2：path.basename sanitizer 打断传播 → sink 不命中
export function loadSafe(savesDir: string, file: string): string {
  const base = path.basename(file)
  const safePath = path.join(savesDir, base)
  return fs.readFileSync(safePath, 'utf8')
}

// case 3：readdirSync source → 循环回边 → join 传播 → sink 命中（text-rpg db.ts 同型）
export function loadAll(dir: string): string[] {
  const files = fs.readdirSync(dir)
  const out: string[] = []
  for (const f of files) {
    out.push(fs.readFileSync(path.join(dir, f), 'utf8'))
  }
  return out
}
