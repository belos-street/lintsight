/**
 * G2 契约 v3：`--fail-on` 置信度阈值与 exit 语义。
 * 未登记规则（oxlint-native）默认 confidence=medium，用 `eslint/no-var` 作稳定探针。
 */
import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runPipeline } from '../src/pipeline'

async function makeProject(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix))
}

async function writeOxlintrc(
  dir: string,
  rules: Record<string, unknown>
): Promise<void> {
  await writeFile(path.join(dir, '.oxlintrc.json'), JSON.stringify({ rules }))
}

describe('G2 fail-on：置信度阈值', () => {
  test('默认 low 拦 medium；medium 拦 medium；high 放行 medium', async () => {
    const dir = await makeProject('lintsight-failon-')
    try {
      await writeOxlintrc(dir, { 'no-var': 'error' })
      await writeFile(path.join(dir, 'a.ts'), 'var a = 1\nconsole.log(a)\n')

      const d = await runPipeline(['.'], { cwd: dir })
      expect(d.exitCode).toBe(1)
      expect(d.report?.diagnostics[0]?.confidence).toBe('medium')

      const m = await runPipeline(['.'], { cwd: dir, failOn: 'medium' })
      expect(m.exitCode).toBe(1)

      const h = await runPipeline(['.'], { cwd: dir, failOn: 'high' })
      expect(h.exitCode).toBe(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('被抑制的 error 不参与 fail-on（任何阈值都 exit 0）', async () => {
    const dir = await makeProject('lintsight-failon-suppressed-')
    try {
      await writeOxlintrc(dir, { 'no-var': 'error' })
      await writeFile(
        path.join(dir, 'a.ts'),
        '// lintsight-ignore-next-line eslint/no-var: 兼容\nvar a = 1\n'
      )
      const r = await runPipeline(['.'], { cwd: dir })
      expect(r.exitCode).toBe(0)
      expect(r.report?.summary.suppressed).toBe(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('warning 永不触发 exit 1（即使 failOn=low）', async () => {
    const dir = await makeProject('lintsight-failon-warn-')
    try {
      await writeOxlintrc(dir, { 'no-debugger': 'warn' })
      await writeFile(path.join(dir, 'a.ts'), 'debugger\n')
      const r = await runPipeline(['.'], { cwd: dir })
      expect(r.exitCode).toBe(0)
      expect(r.report?.summary.warning).toBe(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
