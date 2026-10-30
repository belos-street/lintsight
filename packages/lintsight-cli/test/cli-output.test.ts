/**
 * G2 契约 v3：CLI 输出通道与参数面。
 * - `--output` 时 stdout 必须为空（报告只落文件）
 * - 无 `--output` 时报告走 stdout
 * - `--fail-on` 非法值 exit 2；high 放行 medium error
 */
import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url))

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
  args: string[]
): Promise<{ stdout: string; stderr: string; code: number }> {
  const proc = Bun.spawn([process.execPath, CLI, ...args], {
    cwd,
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

describe('G2 CLI 输出通道', () => {
  test('--output：stdout 为空、文件为 v3 JSON', async () => {
    const dir = await makeProject('lintsight-cli-output-')
    try {
      const out = path.join(dir, 'report.json')
      const r = await spawnCli(dir, ['.', '--format', 'json', '--output', out])
      expect(r.code).toBe(1)
      expect(r.stdout).toBe('')
      const report = JSON.parse(await Bun.file(out).text())
      expect(report.contractVersion).toBe('3')
      expect(typeof report.toolVersion).toBe('string')
      expect(['ok', 'degraded', 'missing', 'crashed', 'timeout']).toContain(
        report.engineStatus
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('无 --output：报告走 stdout', async () => {
    const dir = await makeProject('lintsight-cli-stdout-')
    try {
      const r = await spawnCli(dir, ['.', '--format', 'json'])
      expect(r.code).toBe(1)
      expect(r.stdout).toContain('"contractVersion": "3"')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('--fail-on high：medium error 放行（exit 0）', async () => {
    const dir = await makeProject('lintsight-cli-failon-')
    try {
      const r = await spawnCli(dir, ['.', '--fail-on', 'high'])
      expect(r.code).toBe(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('--fail-on 非法值：exit 2 且 stderr 给出期望值', async () => {
    const dir = await makeProject('lintsight-cli-failon-bad-')
    try {
      const r = await spawnCli(dir, ['.', '--fail-on', 'bogus'])
      expect(r.code).toBe(2)
      expect(r.stderr).toContain('--fail-on 期望 high|medium|low')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('--fail-on 缺值：exit 2，不静默回落 low', async () => {
    const dir = await makeProject('lintsight-cli-failon-missing-')
    try {
      const r = await spawnCli(dir, ['.', '--fail-on'])
      expect(r.code).toBe(2)
      expect(r.stderr).toContain('--fail-on 缺少取值')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
