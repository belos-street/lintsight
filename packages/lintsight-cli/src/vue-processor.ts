/**
 * Vue SFC processor（SV5 · spike ② 最小版）：
 * .vue → 提取 <script> 虚拟块 → 生成与原文件行号 1:1 对齐的虚拟 .ts/.js 文件 → 喂 oxlint。
 * 位置回映射：虚拟文件行号 == 原 .vue 行号，只需把文件路径映射回 .vue。
 *
 * 明确不做（spike 范围外）：
 *   - template 深度分析；同一行开头闭合/单行 script（列偏移无法 1:1）；
 *   - src 外链 script；safe fix 逆映射回写（M1 正式版职责）；
 *   - 就地临时文件约定（M1 正式版须保 .vue 路径上下文，§11.2）——spike 写入 .lintsight-cache/。
 */

export interface VirtualVueFile {
  /** 原 .vue 相对项目根路径 */
  originalRel: string
  /** 虚拟文件绝对路径（cache 内） */
  virtualAbs: string
  content: string
}

const SCRIPT_RE = /<script([^>]*)>([\s\S]*?)<\/script>/

export function extractScriptBlock(
  source: string
): { lang: string; startLine: number; content: string } | null {
  const m = source.match(SCRIPT_RE)
  if (!m) return null
  const attrs = m[1]
  if (/\bsrc=/.test(attrs)) return null // 外链 script 不处理

  const openTagLine = source.slice(0, m.index ?? 0).split('\n').length // <script> 所在行（1-based）

  // 内容紧跟开标签换行开始（标准 SFC 格式）→ 剥离首部换行，内容行 = 开标签行 + 1；
  // 内容与开标签同行 → 列映射无法 1:1，spike 明确不支持
  let content = m[2]
  if (content.startsWith('\r\n')) content = content.slice(2)
  else if (content.startsWith('\n')) content = content.slice(1)
  else return null
  if (content.length === 0) return null

  const lang = attrs.match(/lang="?(ts|tsx|js|jsx)"?/)?.[1] ?? 'js'

  return { lang, startLine: openTagLine + 1, content }
}

/** 构建 1:1 行号对齐的虚拟文件内容（非 script 行全部置空） */
export function buildVirtualContent(
  source: string,
  block: { startLine: number; content: string }
): string {
  const totalLines = source.split('\n').length
  const lines: string[] = new Array(totalLines).fill('')
  const contentLines = block.content.split('\n')
  for (let i = 0; i < contentLines.length; i++) {
    const target = block.startLine - 1 + i
    if (target < totalLines) lines[target] = contentLines[i]
  }
  return lines.join('\n')
}

/** 虚拟路径 → 原 .vue 相对路径；非虚拟路径返回 null */
export function inverseVirtualPath(
  relPath: string,
  cachePrefix: string
): string | null {
  if (!relPath.startsWith(cachePrefix)) return null
  const stripped = relPath.slice(cachePrefix.length)
  const m = stripped.match(/^(.+\.vue)\.(ts|tsx|js|jsx)$/)
  return m ? m[1] : null
}

export async function virtualizeVue(
  vueAbsPath: string,
  projectRoot: string,
  cacheDir: string
): Promise<VirtualVueFile | null> {
  const source = await Bun.file(vueAbsPath).text()
  const block = extractScriptBlock(source)
  if (!block) return null

  const root = projectRoot.endsWith('/')
    ? projectRoot.slice(0, -1)
    : projectRoot
  const originalRel = vueAbsPath.startsWith(`${root}/`)
    ? vueAbsPath.slice(root.length + 1)
    : vueAbsPath
  const ext = block.lang
  const virtualAbs = `${cacheDir}/${originalRel}.${ext}`

  await Bun.write(virtualAbs, buildVirtualContent(source, block))
  return { originalRel, virtualAbs, content: '' }
}
