// oxlint-disable no-await-in-loop -- 样例故意含循环内 await（CFG 演示素材，crates/ 不在 dev-lint 范围）
// spike ① walk 模式样例：覆盖分支 / 多种循环（回边验证）/ try-catch / 作用域嵌套 / 模板串

const API_BASE = 'https://api.example.com'

export async function fetchUser(id: number): Promise<unknown> {
  let retries = 0
  while (retries < 3) {
    try {
      const res = await fetch(`${API_BASE}/users/${id}`)
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      return await res.json()
    } catch (err) {
      console.error('fetch failed', err)
      retries += 1
    }
  }
  return null
}

export function summarize(items: string[], sep = ','): string {
  const out: string[] = []
  for (const item of items) {
    if (item.length === 0) {
      continue
    }
    out.push(item.trim())
  }
  switch (out.length) {
    case 0:
      return ''
    case 1:
      return out[0]
    default:
      return out.join(sep)
  }
}
