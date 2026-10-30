/**
 * G2 契约 v3：行内抑制端到端（`// lintsight-ignore-next-line <ruleId>: <reason>`）。
 * 覆盖合法/非法、.vue 原文件坐标、冷/热一致、引擎诊断抑制。
 */
import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runPipeline } from '../src/pipeline'
import { resolveEngineBin } from '../src/engine-bridge'

const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const engineBin = resolveEngineBin(PROJECT_ROOT)

async function makeProject(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix))
}

async function writeOxlintrc(
  dir: string,
  rules: Record<string, unknown>
): Promise<void> {
  await writeFile(path.join(dir, '.oxlintrc.json'), JSON.stringify({ rules }))
}

describe('G2 行内抑制：pipeline 端到端', () => {
  test('合法指令：error 被抑制、审计字段与 summary 口径正确', async () => {
    const dir = await makeProject('lintsight-suppress-ok-')
    try {
      await writeOxlintrc(dir, { 'no-var': 'error' })
      await writeFile(
        path.join(dir, 'a.ts'),
        '// lintsight-ignore-next-line eslint/no-var: 旧代码兼容\nvar a = 1\nconsole.log(a)\n'
      )
      const r = await runPipeline(['.'], { cwd: dir })
      expect(r.exitCode).toBe(0)
      expect(r.report?.summary).toEqual({
        error: 0,
        warning: 0,
        info: 0,
        suppressed: 1
      })
      const d = r.report?.diagnostics.find((x) => x.ruleId === 'eslint/no-var')
      expect(d?.suppression).toEqual({
        kind: 'inSource',
        justification: '旧代码兼容',
        directiveLine: 1
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('缺 reason：不抑制、exit 1、无审计字段', async () => {
    const dir = await makeProject('lintsight-suppress-noreason-')
    try {
      await writeOxlintrc(dir, { 'no-var': 'error' })
      await writeFile(
        path.join(dir, 'a.ts'),
        '// lintsight-ignore-next-line eslint/no-var:\nvar a = 1\n'
      )
      const r = await runPipeline(['.'], { cwd: dir })
      expect(r.exitCode).toBe(1)
      expect(r.report?.summary.suppressed).toBe(0)
      const d = r.report?.diagnostics.find((x) => x.ruleId === 'eslint/no-var')
      expect(d?.suppression).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('ruleId 不匹配：只抑制精确匹配的规则', async () => {
    const dir = await makeProject('lintsight-suppress-mismatch-')
    try {
      await writeOxlintrc(dir, { 'no-var': 'error' })
      await writeFile(
        path.join(dir, 'a.ts'),
        '// lintsight-ignore-next-line eslint/no-debugger: 无关规则\nvar a = 1\n'
      )
      const r = await runPipeline(['.'], { cwd: dir })
      expect(r.exitCode).toBe(1)
      expect(r.report?.summary.suppressed).toBe(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('.vue：指令按原文件行号生效（虚拟块回映射后仍命中）', async () => {
    const dir = await makeProject('lintsight-suppress-vue-')
    try {
      await writeOxlintrc(dir, { 'no-var': 'error' })
      await writeFile(
        path.join(dir, 'Comp.vue'),
        [
          '<template>',
          '  <div>{{ a }}</div>',
          '</template>',
          '',
          '<script setup lang="ts">',
          '// lintsight-ignore-next-line eslint/no-var: Vue 兼容',
          'var a = 1',
          '</script>',
          ''
        ].join('\n')
      )
      const r = await runPipeline(['Comp.vue'], { cwd: dir })
      expect(r.exitCode).toBe(0)
      const d = r.report?.diagnostics.find((x) => x.ruleId === 'eslint/no-var')
      expect(d?.file).toBe('Comp.vue')
      expect(d?.span.line).toBe(7)
      expect(d?.suppression?.directiveLine).toBe(6)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('冷/热一致：抑制在缓存命中后重新应用', async () => {
    const dir = await makeProject('lintsight-suppress-cache-')
    try {
      await writeOxlintrc(dir, { 'no-var': 'error' })
      await writeFile(
        path.join(dir, 'a.ts'),
        '// lintsight-ignore-next-line eslint/no-var: 兼容\nvar a = 1\n'
      )
      const r1 = await runPipeline(['.'], { cwd: dir })
      const r2 = await runPipeline(['.'], { cwd: dir })
      expect(r1.report?.diagnostics).toEqual(r2.report?.diagnostics)
      expect(r2.exitCode).toBe(0)
      expect(r2.cache).toEqual({ enabled: true, hits: 1, misses: 0 })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe.skipIf(!engineBin)('G2 行内抑制：引擎诊断', () => {
  test('lintsight-engine/no-eval 可按指令抑制（未被 M1 双报消解影响）', async () => {
    const dir = await makeProject('lintsight-suppress-engine-')
    try {
      await writeOxlintrc(dir, {})
      await writeFile(
        path.join(dir, 'a.ts'),
        '// lintsight-ignore-next-line lintsight-engine/no-eval: 受控沙箱\n eval("1")\n'
      )
      const r = await runPipeline(['.'], { cwd: dir })
      expect(r.exitCode).toBe(0)
      const d = r.report?.diagnostics.find(
        (x) => x.ruleId === 'lintsight-engine/no-eval'
      )
      expect(d?.suppression).toEqual({
        kind: 'inSource',
        justification: '受控沙箱',
        directiveLine: 1
      })
      expect(r.report?.summary.suppressed).toBe(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
