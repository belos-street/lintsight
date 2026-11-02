/**
 * G12 E2E：空配置 preset / 无 config 边界 / preset none / fail-on confidence。
 */
import { describe, expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runPipeline } from '../src/pipeline'

const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

async function makeProject(
  prefix: string,
  config: unknown | null
): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix))
  await cp(path.join(PROJECT_ROOT, 'plugins'), path.join(dir, 'plugins'), {
    recursive: true
  })
  await mkdir(path.join(dir, 'src'), { recursive: true })
  await cp(path.join(PROJECT_ROOT, 'fixtures/preset'), path.join(dir, 'src'), {
    recursive: true
  })
  if (config !== null) {
    await writeFile(
      path.join(dir, 'lintsight.config.json'),
      JSON.stringify(config)
    )
  }
  return dir
}

async function scan(dir: string, extra: Record<string, unknown> = {}) {
  return runPipeline(['src'], {
    cwd: PROJECT_ROOT,
    root: dir,
    cache: false,
    logLevel: 'error',
    ...extra
  })
}

describe('G12 preset E2E', () => {
  test('空配置 {"rules":{}} → 自有安全规则 + 1b 内置命中', async () => {
    const dir = await makeProject('lintsight-preset-empty-', { rules: {} })
    try {
      const r = await scan(dir)
      const ids = new Set(r.report?.diagnostics.map((d) => d.ruleId))
      expect(ids.has('lintsight/no-hardcoded-credentials')).toBe(true)
      expect(ids.has('eslint/no-new-func')).toBe(true)
      expect(ids.has('unicorn/no-document-cookie')).toBe(true)
      expect(ids.has('eslint/no-fallthrough')).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('无 config → preset 不生效（无自有/1b 诊断，边界钉死）', async () => {
    const dir = await makeProject('lintsight-preset-noconfig-', null)
    try {
      const r = await scan(dir)
      const diags = r.report?.diagnostics ?? []
      expect(
        diags.filter((d) => d.ruleId.startsWith('lintsight/'))
      ).toHaveLength(0)
      expect(diags.some((d) => d.ruleId === 'eslint/no-new-func')).toBe(false)
      expect(diags.some((d) => d.ruleId === 'unicorn/no-document-cookie')).toBe(
        false
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('preset:none → 恢复现状（无自有/1b 诊断）', async () => {
    const dir = await makeProject('lintsight-preset-none-', {
      preset: 'none'
    })
    try {
      const r = await scan(dir)
      const diags = r.report?.diagnostics ?? []
      expect(
        diags.filter((d) => d.ruleId.startsWith('lintsight/'))
      ).toHaveLength(0)
      expect(diags.some((d) => d.ruleId === 'eslint/no-new-func')).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('security 预设：low confidence error 不被 fail-on high 拦截，low 拦截', async () => {
    const dir = await makeProject('lintsight-preset-failon-', {
      preset: 'security'
    })
    try {
      // 只保留 low-confidence 样本，避免其他 error 干扰 fail-on 断言
      await rm(path.join(dir, 'src/bad-1.ts'))
      await rm(path.join(dir, 'src/bad-2.ts'))
      const high = await scan(dir, { failOn: 'high' })
      expect(high.exitCode).toBe(0)
      const low = await scan(dir, { failOn: 'low' })
      expect(low.exitCode).toBe(1)
      const hit = low.report?.diagnostics.find(
        (d) => d.ruleId === 'lintsight/no-non-literal-fs-filename'
      )
      expect(hit?.severity).toBe('error')
      expect(hit?.confidence).toBe('low')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
