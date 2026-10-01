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
import { existsSync } from 'node:fs'

export interface EngineDiagnostic {
  ruleId: string
  severity: 'error' | 'warning'
  message: string
  file: string
  span: { offset: number; length: number; line: number; column: number }
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
  opts: { cwd?: string } = {}
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
    proc.stdin.write(JSON.stringify({ files }))
    proc.stdin.end()
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
