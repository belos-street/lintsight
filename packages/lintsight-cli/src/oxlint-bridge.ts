/**
 * oxlint 进程桥接（SV2）：spawn oxlint -f json，解析并归一化诊断。
 * 归一化规则（diagnostic-bridge 最小版）：
 *   - code "eslint(no-debugger)" → ruleId "eslint/no-debugger"
 *   - filename → 相对项目根的 POSIX 路径（保证指纹跨机器稳定）
 *   - severity 保持 oxlint 原值（error/warning/advice）
 */
import { existsSync } from 'node:fs'

export interface OxlintSpan {
  /** 字节偏移（oxlint 返回的是 byte offset） */
  offset: number
  length: number
  /** 1-based */
  line: number
  /** 1-based */
  column: number
}

export interface OxlintDiagnostic {
  message: string
  /** oxlint 原始 code，如 "eslint(no-debugger)" */
  code: string
  severity: string
  filename: string
  labels: { span: OxlintSpan }[]
  url?: string
  help?: string
}

export interface OxlintJsonOutput {
  diagnostics: OxlintDiagnostic[]
  number_of_files: number
  number_of_rules: number
}

export interface NormalizedDiagnostic {
  ruleId: string
  severity: string
  message: string
  /** 相对项目根路径 */
  file: string
  span: OxlintSpan
}

export interface OxlintRunResult {
  /** oxlint 进程是否正常退出（0=无诊断，1=有诊断，其他=运行错误） */
  ok: boolean
  exitCode: number
  stderr: string
  output: OxlintJsonOutput | null
  normalized: NormalizedDiagnostic[]
}

/** "eslint(no-debugger)" → "eslint/no-debugger"；已含 "/" 的原样返回 */
export function normalizeRuleId(code: string): string {
  const m = code.match(/^([\w-]+)\(([\w-]+)\)$/)
  return m ? `${m[1]}/${m[2]}` : code
}

/** 把 filename 归一为相对项目根的 POSIX 路径。
 * 实测（oxlint 1.83.0）：相对输入 → 相对路径；绝对输入 → 去掉开头 '/' 的路径。两种都要兜住。 */
export function normalizeFilePath(
  filename: string,
  projectRoot: string
): string {
  const root = projectRoot.endsWith('/')
    ? projectRoot.slice(0, -1)
    : projectRoot
  const candidates = filename.startsWith('/')
    ? [filename]
    : [`${root}/${filename}`, `/${filename}`]
  for (const abs of candidates) {
    if (abs.startsWith(`${root}/`)) return abs.slice(root.length + 1)
  }
  return filename
}

/**
 * oxlint 可执行文件解析链（DR-7 实测后定案）：
 * 1. OXLINT_BIN 环境变量 —— 平台 worker / CI 镜像显式指定
 * 2. cwd 下的 node_modules/.bin/oxlint —— 业务项目自带（compile 单文件分发的伴生依赖）
 * 3. monorepo 开发态路径（bun run 场景，import.meta 相对定位；compile 后 $bunfs 内不存在自动跳过）
 */
export function resolveOxlintBin(): string {
  if (process.env.OXLINT_BIN) return process.env.OXLINT_BIN
  const candidates = [
    `${process.cwd()}/node_modules/.bin/oxlint`,
    new URL('../../../node_modules/.bin/oxlint', import.meta.url).pathname
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  throw new Error(
    'oxlint not found: install oxlint (npm/bun) or set OXLINT_BIN'
  )
}

export async function runOxlint(
  paths: string[],
  opts: { config?: string; cwd?: string } = {}
): Promise<OxlintRunResult> {
  const cwd = opts.cwd ?? process.cwd()
  const args = ['-f', 'json']
  if (opts.config) args.push('--config', opts.config)
  args.push(...paths)

  const proc = Bun.spawn([resolveOxlintBin(), ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe'
  })
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text()
  ])
  const exitCode = await proc.exited

  let output: OxlintJsonOutput | null = null
  if (stdout.trim().startsWith('{')) {
    try {
      output = JSON.parse(stdout) as OxlintJsonOutput
    } catch {
      output = null
    }
  }

  const projectRoot = cwd
  const normalized: NormalizedDiagnostic[] = (output?.diagnostics ?? []).map(
    (d) => ({
      ruleId: normalizeRuleId(d.code),
      severity: d.severity,
      message: d.message,
      file: normalizeFilePath(d.filename, projectRoot),
      span: d.labels[0]?.span ?? { offset: 0, length: 0, line: 0, column: 0 }
    })
  )

  return {
    ok: exitCode === 0 || exitCode === 1,
    exitCode,
    stderr,
    output,
    normalized
  }
}
