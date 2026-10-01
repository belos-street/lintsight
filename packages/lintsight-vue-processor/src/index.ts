/**
 * Vue SFC processor（design-m1 §4.3 / M1-DR5 / requirements §11.2）：
 * .vue → 提取 <script> 块 → 生成与原文件行号 1:1 对齐的虚拟文件 → 就地临时文件喂 oxlint。
 *
 * S5 定案（T1.14，就地临时文件约定取代 M1 初版 cache 目录方案）：
 *   - 就地写入：<Foo.vue> 同目录写 Foo.vue.lintsight-<pid>-<seq>.<lang>——
 *     同目录保 import 解析上下文（tsconfig/别名不再退化）；pid+序号隔离并发双跑写冲突；
 *     gitignore 规则防误提交（ensureGitignore）。
 *   - 多 script 块策略：优先 <script setup>（SFC 编译主块），否则首个可处理 <script>；
 *     其余块显式告警（不静默漏扫）。同行开标签 / src 外链同样显式告警。
 *   - 位置回映射：pipeline 用本次运行精确路径表（virtualRel → originalRel），不做模式猜测，
 *     用户自己的 Foo.vue.ts 文件不受影响。
 *
 * safe fix 逆映射回写（T1.15，oxlint 1.83.0 实测）：
 *   - JSON 诊断无 fix 字段，唯一机制 = `--fix` 就地改写文件 → 差量行回写；
 *   - 回写边界：仅行数不变的 diff 逐行 1:1 拷回（M1-DR5 对齐红利）；
 *     行数变化显式跳过并告警，不猜行号。
 *
 * 明确不做（M1 边界）：template 深度分析；多块内容合并（取一弃余）。
 */

export interface VirtualVueFile {
  /** 原 .vue 相对项目根路径（POSIX） */
  originalRel: string
  /** 原 .vue 绝对路径 */
  originalAbs: string
  /** 就地临时文件绝对路径（喂 oxlint） */
  virtualAbs: string
  /** 就地临时文件相对项目根路径（诊断回映射键） */
  virtualRel: string
  lang: string
  /** 无法处理/被跳过的 script 块告警（显式不静默） */
  warnings: string[]
}

export interface SelectedScript {
  block: { lang: string; startLine: number; content: string } | null
  warnings: string[]
}

interface RawBlock {
  attrs: string
  isSetup: boolean
  startLine: number
  content: string | null // null = 同行开标签，列无法 1:1
  lang: string
}

const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script>/g

/** 就地临时文件名匹配（collectFiles 排除 + gitignore 规则同口径） */
const VIRTUAL_NAME_RE = /\.lintsight-\d+(-\d+)?\.(ts|tsx|js|jsx)$/

export function isInPlaceVirtualPath(p: string): boolean {
  return VIRTUAL_NAME_RE.test(p)
}

function parseRawBlock(source: string, m: RegExpExecArray): RawBlock {
  const attrs = m[1]
  const openTagLine = source.slice(0, m.index).split('\n').length // 1-based
  const content = m[2]
  // 内容紧跟开标签换行开始（标准 SFC 格式）→ 剥离首部换行，内容行 = 开标签行 + 1；
  // 内容与开标签同行 → 列映射无法 1:1，显式不支持
  let stripped = content
  if (stripped.startsWith('\r\n')) stripped = stripped.slice(2)
  else if (stripped.startsWith('\n')) stripped = stripped.slice(1)
  const hasSameLineOpen = stripped === content && content.length > 0
  const lang = attrs.match(/lang="?(ts|tsx|js|jsx)"?/)?.[1] ?? 'js'
  return {
    attrs,
    isSetup: /\bsetup\b/.test(attrs),
    startLine: openTagLine + 1,
    content: hasSameLineOpen ? null : content,
    lang
  }
}

/**
 * 选择要虚拟化的 script 块（S5 多块策略）：
 * 优先 <script setup>，否则首个可处理 <script>；不支持/被跳过的块产出告警。
 */
export function selectScriptBlock(source: string): SelectedScript {
  const warnings: string[] = []
  const blocks: RawBlock[] = []
  for (const m of source.matchAll(SCRIPT_RE)) {
    if (/\bsrc=/.test(m[1])) {
      warnings.push('vue-processor: 外链 <script src> 块不支持，已跳过')
      continue
    }
    blocks.push(parseRawBlock(source, m))
  }

  const sameLine = blocks.filter((b) => b.content === null)
  for (const b of sameLine) {
    warnings.push(
      `vue-processor: 第 ${b.startLine - 1} 行开标签与代码同行，列无法 1:1 映射，已跳过`
    )
  }

  const candidates = blocks.filter((b) => {
    if (b.content === null) return false
    if (b.content.trim().length === 0) return false // 空 script 块：无可扫描内容
    return true
  })
  const chosen = candidates.find((b) => b.isSetup) ?? candidates[0] ?? null
  const skipped = candidates.filter((b) => b !== chosen)
  for (const b of skipped) {
    warnings.push(
      `vue-processor: 第 ${b.startLine} 行起的 script 块未被选中（多块策略：优先 setup），已跳过`
    )
  }

  if (!chosen) return { block: null, warnings }

  let content = chosen.content!
  if (content.startsWith('\r\n')) content = content.slice(2)
  else if (content.startsWith('\n')) content = content.slice(1)
  if (content.length === 0) return { block: null, warnings }

  return {
    block: { lang: chosen.lang, startLine: chosen.startLine, content },
    warnings
  }
}

/** 构建 1:1 行号对齐的虚拟文件内容（非 script 行全部置空） */
export function buildVirtualContent(
  source: string,
  block: { startLine: number; content: string }
): string {
  const totalLines = source.split('\n').length
  const lines: string[] = Array.from({ length: totalLines }, () => '')
  const contentLines = block.content.split('\n')
  for (let i = 0; i < contentLines.length; i++) {
    const target = block.startLine - 1 + i
    if (target < totalLines) lines[target] = contentLines[i]
  }
  return lines.join('\n')
}

// 进程内序号：同进程多 pipeline 并发跑同一 .vue（bun test 场景）时隔离临时文件名
let virtualSeq = 0

/** .vue → 就地临时虚拟文件（同目录，保 import 解析上下文）；无可处理 script 块返回 null */
export async function virtualizeVue(
  vueAbsPath: string,
  projectRoot: string
): Promise<VirtualVueFile | null> {
  const source = await Bun.file(vueAbsPath).text()
  const { block, warnings } = selectScriptBlock(source)
  if (!block) return null

  const root = projectRoot.endsWith('/')
    ? projectRoot.slice(0, -1)
    : projectRoot
  const originalRel = vueAbsPath.startsWith(`${root}/`)
    ? vueAbsPath.slice(root.length + 1)
    : vueAbsPath
  const suffix = `lintsight-${process.pid}-${virtualSeq++}`
  const virtualAbs = `${vueAbsPath}.${suffix}.${block.lang}`
  const virtualRel = `${originalRel}.${suffix}.${block.lang}`

  await Bun.write(virtualAbs, buildVirtualContent(source, block))
  return {
    originalRel,
    originalAbs: vueAbsPath,
    virtualAbs,
    virtualRel,
    lang: block.lang,
    warnings
  }
}

export interface FixWritebackResult {
  /** 是否发生回写 */
  changed: boolean
  /** 回写的行数 */
  lines: number
  /** true = 行数变化，显式跳过（M1 边界，不猜行号） */
  skipped: boolean
}

/**
 * safe fix 逆映射回写（T1.15）：oxlint --fix 就地改写虚拟文件后，
 * 与预写虚拟内容做行级 diff，行数不变则把改动行逐行拷回原 .vue（1:1 对齐）。
 */
export async function writebackFix(
  vueAbsPath: string,
  virtualAbsPath: string
): Promise<FixWritebackResult> {
  const virtualFile = Bun.file(virtualAbsPath)
  if (!(await virtualFile.exists())) {
    return { changed: false, lines: 0, skipped: false }
  }
  const postFix = await virtualFile.text()
  const source = await Bun.file(vueAbsPath).text()
  const { block } = selectScriptBlock(source)
  if (!block) return { changed: false, lines: 0, skipped: true }

  const preFix = buildVirtualContent(source, block)
  if (preFix === postFix) return { changed: false, lines: 0, skipped: false }

  const preLines = preFix.split('\n')
  const postLines = postFix.split('\n')
  if (preLines.length !== postLines.length) {
    return { changed: false, lines: 0, skipped: true }
  }

  const originalLines = source.split('\n')
  let changed = 0
  for (let i = 0; i < preLines.length; i++) {
    if (preLines[i] !== postLines[i]) {
      originalLines[i] = postLines[i]
      changed++
    }
  }
  await Bun.write(vueAbsPath, originalLines.join('\n'))
  return { changed: true, lines: changed, skipped: false }
}

const GITIGNORE_MARKER = '# lintsight: vue in-place temp files'
const GITIGNORE_BLOCK = `${GITIGNORE_MARKER} (auto-generated)
*.lintsight-*.ts
*.lintsight-*.tsx
*.lintsight-*.js
*.lintsight-*.jsx
`

/**
 * 就地临时文件 gitignore 规则（requirements §11.2）：项目已存在 .gitignore 且缺少
 * 本条目时幂等追加；不主动创建 .gitignore（避免副作用面扩大）。
 */
export async function ensureGitignore(projectRoot: string): Promise<boolean> {
  const path = `${projectRoot}/.gitignore`
  const file = Bun.file(path)
  if (!(await file.exists())) return false
  const content = await file.text()
  if (content.includes(GITIGNORE_MARKER)) return false
  const sep = content.length > 0 && !content.endsWith('\n') ? '\n' : ''
  await Bun.write(path, `${content}${sep}\n${GITIGNORE_BLOCK}`)
  return true
}
