/**
 * oxlint 进程桥接（design-m1 §4.1）：spawn oxlint -f json 并解析。
 * 归一化 / 指纹等诊断职责在 @lintsight/diagnostic；本模块只负责进程编排。
 */
import { existsSync } from 'node:fs'
import type { OxlintJsonOutput } from '@lintsight/diagnostic'

/**
 * oxlint 可执行文件解析链（M1-DR1，compile 实测定案）：
 * 1. OXLINT_BIN 环境变量 —— 平台 worker / CI 镜像显式指定
 * 2. cwd 下的 node_modules/.bin/oxlint —— 业务项目自带（compile 单文件分发的伴生依赖）
 * 3. monorepo 开发态路径（bun run 场景，import.meta 相对定位；compile 后 $bunfs 内不存在自动跳过）
 */
export function resolveOxlintBin(cwd: string = process.cwd()): string {
  if (process.env.OXLINT_BIN) return process.env.OXLINT_BIN
  const candidates = [
    `${cwd}/node_modules/.bin/oxlint`,
    new URL('../../../node_modules/.bin/oxlint', import.meta.url).pathname,
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  throw new Error('oxlint not found: install oxlint (npm/bun) or set OXLINT_BIN')
}

export interface OxlintRunResult {
  /** oxlint 进程是否正常退出（0=无诊断，1=有诊断，其他=运行错误） */
  ok: boolean
  exitCode: number
  stderr: string
  output: OxlintJsonOutput | null
}

export async function runOxlint(
  paths: string[],
  opts: { config?: string; cwd?: string } = {}
): Promise<OxlintRunResult> {
  const cwd = opts.cwd ?? process.cwd()
  const args = ['-f', 'json']
  if (opts.config) args.push('--config', opts.config)
  args.push(...paths)

  const proc = Bun.spawn([resolveOxlintBin(cwd), ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
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

  return { ok: exitCode === 0 || exitCode === 1, exitCode, stderr, output }
}
