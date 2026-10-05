/**
 * M2 引擎桥接（design-m2 §4.3）：spawn lintsight-engine sidecar（JSON Lines 协议）。
 *
 * fail-open（M2-DR3）：引擎二进制缺失 = 正常形态（diagnostics=null, degraded=false）；
 * 引擎启动/解析失败 = 降级（degraded=true）——两种情况管线都继续纯 M1 扫描，绝不阻塞。
 *
 * 二进制解析链（承接 M1-DR1 风格）：
 *   1. OXLINT_ENGINE_BIN 环境变量
 *   2. cwd 下 node_modules/.bin/lintsight-engine（业务项目自带）
 *   3. monorepo 开发态 cargo 产物路径（bun run 场景；compile 后不存在自动跳过）
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { parseJsonc } from '@lintsight/config-bridge'
import type { ArchConfig } from '@lintsight/config-bridge'

/** tsconfig paths 映射（FR-304 别名兜底）：pattern/targets 均为相对 root 的 POSIX 路径，
 * 保留 `*` 通配；`dir` = 拥有该 tsconfig 的目录（"" = 根），引擎按 importer 的
 * 最近祖先 tsconfig 选映射集（TS 语义）。已按 TS best-match 语义排序（同 dir 内
 * pattern 固定前缀长者优先）。 */
export interface TsPathMapping {
  dir: string
  pattern: string
  targets: string[]
}

/** 递归发现跳过的目录（依赖/产物/隐藏目录——别名发现不进这些树） */
const TS_DISCOVERY_SKIP = new Set([
  'node_modules',
  '.git',
  '.lintsight-cache',
  'dist',
  'build',
  'coverage',
  '.next',
  '.nuxt'
])

/** 读扫描树内全部 tsconfig.json（JSONC）→ paths + baseUrl 归一化为相对 root
 * 的映射表（FR-304① 嵌套 tsconfig / per-package paths）。
 * 发现范围 = roots（扫描根，目录递归）+ cwd 根 tsconfig——别名只对扫描文件生效，
 * 不做全仓 IO（bench 回归教训：全 cwd 递归在大仓会吃掉两位数 ms）。
 * fail-open：无 tsconfig / 全部无 paths / 解析失败 → null（引擎侧维持裸说明符
 * 跳过语义）。v0 边界：不解析 `extends`（引用链上的 paths 不继承）。 */
export async function resolveTsPaths(
  cwd: string,
  roots: string[] = []
): Promise<TsPathMapping[] | null> {
  const files: string[] = [path.join(cwd, 'tsconfig.json')]
  const walkRoots = roots.length > 0 ? roots : []
  const walk = (dir: string, depth: number): void => {
    if (depth > 32 || files.length >= 500) return
    let entries: import('node:fs').Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (TS_DISCOVERY_SKIP.has(e.name) || e.name.startsWith('.')) continue
        walk(full, depth + 1)
      } else if (e.name === 'tsconfig.json' && full !== files[0]) {
        files.push(full)
      }
    }
  }
  for (const r of walkRoots) {
    const abs = path.resolve(cwd, r)
    let st: import('node:fs').Stats
    try {
      st = statSync(abs)
    } catch {
      continue
    }
    if (st.isDirectory()) walk(abs, 0)
    // 文件输入不递归（适用 tsconfig = cwd 根，已含）
  }

  type TsConfigRaw = {
    compilerOptions?: { baseUrl?: string; paths?: Record<string, unknown> }
  } | null
  // 并行读全部 tsconfig（坏文件 → null 跳过该层，fail-open 其余层不受影响）
  const texts = await Promise.all(
    files.map(async (f) => {
      try {
        return (parseJsonc(await Bun.file(f).text()) as TsConfigRaw) ?? null
      } catch {
        return null
      }
    })
  )
  const out: (TsPathMapping & { prefixLen: number })[] = []
  for (let i = 0; i < files.length; i++) {
    const raw = texts[i]
    if (!raw) continue
    const dir = path.dirname(files[i])
    const dirRel = path.relative(cwd, dir).split(path.sep).join('/')
    const paths = raw?.compilerOptions?.paths
    if (!paths || typeof paths !== 'object') continue
    // paths targets 相对 baseUrl（TS4.1+ 缺省 = 相对各自 tsconfig 目录）
    const base =
      typeof raw?.compilerOptions?.baseUrl === 'string'
        ? path.resolve(dir, raw.compilerOptions.baseUrl)
        : dir
    for (const [pattern, targets] of Object.entries(paths)) {
      if (!Array.isArray(targets)) continue
      const norm = targets
        .filter((t): t is string => typeof t === 'string')
        .map((t) =>
          path.relative(cwd, path.resolve(base, t)).split(path.sep).join('/')
        )
      if (norm.length === 0) continue
      // TS best-match：pattern `*` 前的固定前缀越长优先级越高（dir 内排序）
      out.push({
        dir: dirRel,
        pattern,
        targets: norm,
        prefixLen: pattern.split('*')[0].length
      })
    }
  }
  if (out.length === 0) return null
  // 目录序（引擎按 dir 取最近祖先集）+ 同 dir 内 best-match 序
  out.sort((a, b) => a.dir.localeCompare(b.dir) || b.prefixLen - a.prefixLen)
  return out.map(({ dir, pattern, targets }) => ({ dir, pattern, targets }))
}

export interface EnginePathEvent {
  kind: 'source' | 'propagation' | 'sanitizer' | 'sink'
  /** 如 "fs.readdirSync" / "path.join" */
  node: string
  offset: number
}

export interface EngineDiagnostic {
  ruleId: string
  severity: 'error' | 'warning'
  message: string
  file: string
  span: { offset: number; length: number; line: number; column: number }
  /** taint 规则证据链（design-m2 §4.2）；普通规则无此字段。
   * contract v1 的 LintsightDiagnostic 暂不承载（T2.5 合并与契约切片接入）。 */
  pathEvents?: EnginePathEvent[]
}

export interface EngineRunResult {
  /** null = 引擎不可用/失败（降级）；非 null = 协议正常（可为空数组） */
  diagnostics: EngineDiagnostic[] | null
  /** true = 引擎曾可用但本次失败（fail-open 降级） */
  degraded: boolean
}

export function resolveEngineBin(cwd: string = process.cwd()): string | null {
  if (process.env.OXLINT_ENGINE_BIN) return process.env.OXLINT_ENGINE_BIN
  const candidates = [
    `${cwd}/node_modules/.bin/lintsight-engine`,
    new URL(
      '../../../crates/lintsight-engine/target/release/lintsight-engine',
      import.meta.url
    ).pathname
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return null
}

export async function runEngine(
  files: string[],
  opts: {
    cwd?: string
    arch?: ArchConfig
    tsPaths?: TsPathMapping[] | null
  } = {}
): Promise<EngineRunResult> {
  const cwd = opts.cwd ?? process.cwd()
  const bin = resolveEngineBin(cwd)
  if (!bin || files.length === 0) {
    return { diagnostics: null, degraded: false }
  }

  try {
    const proc = Bun.spawn([bin, '--root', cwd], {
      cwd,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe'
    })
    // arch（T2.4）/ tsPaths（FR-304 别名兜底）随 stdin 下发；缺省时引擎侧规则不注册。
    // void：write/end 在部分 bun-types 版本返回 Promise——no-floating-promises
    // 要求显式标注「有意不等待」（type-aware 试点首获，M1 语法层盲区）
    void proc.stdin.write(
      JSON.stringify({
        files,
        arch: opts.arch ?? null,
        tsPaths: opts.tsPaths ?? null
      })
    )
    void proc.stdin.end()
    // stderr 流必须消费（防子进程阻塞），内容不进结果（降级细节由调用方按需取 stderr）
    const [stdout] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text().catch(() => '')
    ])
    const exitCode = await proc.exited
    if (exitCode !== 0) {
      return { diagnostics: null, degraded: true }
    }

    const diagnostics: EngineDiagnostic[] = []
    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue
      let obj: unknown
      try {
        obj = JSON.parse(line)
      } catch {
        return { diagnostics: null, degraded: true } // 协议损坏 → 降级
      }
      const rec = obj as { type?: string; ruleId?: string }
      if (rec.type !== 'diagnostic' || !rec.ruleId) continue
      diagnostics.push(obj as EngineDiagnostic)
    }
    return { diagnostics, degraded: false }
  } catch {
    return { diagnostics: null, degraded: true }
  }
}
