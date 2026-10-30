/**
 * G6 fail-open 可观测：pipeline failClosed 与 CLI --fail-closed。
 * timeout 的进程级竞速在 engine-bridge.test.ts 覆盖（fake proc）。
 */
import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runPipeline } from '../src/pipeline'
import { resolveEngineBin } from '../src/engine-bridge'

const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url))
const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const engineBin = resolveEngineBin(PROJECT_ROOT)

async function makeProject(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix))
  await writeFile(
    path.join(dir, '.oxlintrc.json'),
    JSON.stringify({ rules: { 'no-var': 'error' } })
  )
  await writeFile(path.join(dir, 'a.ts'), 'var a = 1\nconsole.log(a)\n')
  return dir
}

async function spawnCli(
  cwd: string,
  args: string[],
  env: Record<string, string>
): Promise<{ stdout: string; stderr: string; code: number }> {
  const proc = Bun.spawn([process.execPath, CLI, ...args], {
    cwd,
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe'
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited
  ])
  return { stdout, stderr, code }
}

describe('G6 fail-closed：pipeline', () => {
  test('missing + fail-open：exit 由诊断决定，报告 engineStatus=missing', async () => {
    const dir = await makeProject('lintsight-failopen-missing-')
    const missing = path.join(dir, 'no-such-engine')
    const restore = setEngineBin(missing)
    try {
      const r = await runPipeline(['.'], { cwd: dir })
      expect(r.exitCode).toBe(1)
      expect(r.report?.engineStatus).toBe('missing')
      expect(r.degraded).toBe(false)
    } finally {
      restore()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('missing + failClosed：exit 2，report 保留且 error 含 status', async () => {
    const dir = await makeProject('lintsight-failclosed-missing-')
    const missing = path.join(dir, 'no-such-engine')
    const restore = setEngineBin(missing)
    try {
      const r = await runPipeline(['.'], { cwd: dir, failClosed: true })
      expect(r.exitCode).toBe(2)
      expect(r.report).not.toBeNull()
      expect(r.report?.engineStatus).toBe('missing')
      expect(r.error).toContain('status=missing')
    } finally {
      restore()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('crashed + failClosed：exit 2，report engineStatus=crashed', async () => {
    const dir = await makeProject('lintsight-failclosed-crashed-')
    const bad = path.join(dir, 'bad-engine')
    const restore = setEngineBin(bad)
    try {
      await writeFile(bad, 'not an executable\n')
      const r = await runPipeline(['.'], { cwd: dir, failClosed: true })
      expect(r.exitCode).toBe(2)
      expect(r.report?.engineStatus).toBe('crashed')
      expect(r.degraded).toBe(true)
      expect(r.error).toContain('status=crashed')
    } finally {
      restore()
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe.skipIf(!engineBin)(
  'G6 fail-closed：timeout（真实引擎 + 1ms 超时）',
  () => {
    test('timeout + failClosed：exit 2，report engineStatus=timeout', async () => {
      const dir = await makeProject('lintsight-failclosed-timeout-')
      try {
        const r = await runPipeline(['.'], {
          cwd: dir,
          failClosed: true,
          engineTimeoutMs: 1
        })
        expect(r.exitCode).toBe(2)
        expect(r.report).not.toBeNull()
        expect(r.report?.engineStatus).toBe('timeout')
        expect(r.error).toContain('status=timeout')
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    })
  }
)

describe('G6 fail-closed：CLI', () => {
  test('--fail-closed --output：exit 2、stdout 为空、文件保留 engineStatus', async () => {
    const dir = await makeProject('lintsight-failclosed-cli-')
    try {
      const out = path.join(dir, 'report.json')
      const r = await spawnCli(
        dir,
        ['.', '--fail-closed', '--format', 'json', '--output', out],
        { OXLINT_ENGINE_BIN: path.join(dir, 'no-such-engine') }
      )
      expect(r.code).toBe(2)
      expect(r.stdout).toBe('')
      expect(r.stderr).toContain('engine fail-closed: status=missing')
      const report = JSON.parse(await Bun.file(out).text())
      expect(report.engineStatus).toBe('missing')
      expect(report.diagnostics.length).toBeGreaterThan(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

function setEngineBin(value: string): () => void {
  const prev = process.env.OXLINT_ENGINE_BIN
  process.env.OXLINT_ENGINE_BIN = value
  return () => {
    if (prev === undefined) delete process.env.OXLINT_ENGINE_BIN
    else process.env.OXLINT_ENGINE_BIN = prev
  }
}
