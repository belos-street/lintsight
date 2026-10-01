/**
 * T2.1 M2 引擎桥接测试（design-m2 §4.3）：fail-open 降级路径 + spawn 联通 + pipeline 集成。
 * 联通用例依赖 cargo release 产物（crates/lintsight-engine/target/release/），未构建时自动跳过；
 * 降级用例通过 OXLINT_ENGINE_BIN 注入假二进制（不存在 / 协议损坏）。
 */
import { describe, expect, test } from 'bun:test'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resolveEngineBin, runEngine } from '../src/engine-bridge'
import { runPipeline } from '../src/pipeline'

const PROJECT_ROOT = new URL('../../../', import.meta.url).pathname

function setEngineBin(value: string | undefined): () => void {
  const prev = process.env.OXLINT_ENGINE_BIN
  if (value === undefined) delete process.env.OXLINT_ENGINE_BIN
  else process.env.OXLINT_ENGINE_BIN = value
  return () => {
    if (prev === undefined) delete process.env.OXLINT_ENGINE_BIN
    else process.env.OXLINT_ENGINE_BIN = prev
  }
}

describe('engine-bridge: 二进制解析与降级', () => {
  test('OXLINT_ENGINE_BIN 显式优先于探测链', () => {
    const restore = setEngineBin('/opt/custom-engine')
    try {
      expect(resolveEngineBin(tmpdir())).toBe('/opt/custom-engine')
    } finally {
      restore()
    }
  })

  test('files 为空 → 不调用引擎，正常形态返回', async () => {
    const restore = setEngineBin('/opt/never-spawned')
    try {
      const r = await runEngine([], { cwd: tmpdir() })
      expect(r).toEqual({ diagnostics: null, degraded: false })
    } finally {
      restore()
    }
  })

  test('二进制不存在 → spawn 失败 → 降级（degraded=true）', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lintsight-engine-miss-'))
    const restore = setEngineBin(path.join(dir, 'no-such-bin'))
    try {
      const r = await runEngine(['a.ts'], { cwd: dir })
      expect(r.diagnostics).toBeNull()
      expect(r.degraded).toBe(true)
    } finally {
      restore()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('协议损坏（exit 0 但输出非 JSON）→ 降级', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lintsight-engine-bad-'))
    const restore = setEngineBin(path.join(dir, 'fake-engine.sh'))
    try {
      const fake = path.join(dir, 'fake-engine.sh')
      await writeFile(fake, '#!/bin/sh\necho "not json"\n')
      await chmod(fake, 0o755)
      const r = await runEngine(['a.ts'], { cwd: dir })
      expect(r.diagnostics).toBeNull()
      expect(r.degraded).toBe(true)
    } finally {
      restore()
      await rm(dir, { recursive: true, force: true })
    }
  })
})

const engineBin = resolveEngineBin(PROJECT_ROOT)

describe.skipIf(!engineBin)('engine-bridge: spawn 联通（真实 sidecar）', () => {
  test('eval 文件命中 lintsight-engine/no-eval；干净文件返回空诊断数组', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lintsight-engine-e2e-'))
    try {
      await writeFile(path.join(dir, 'bad.ts'), 'eval("1+1")\n')
      await writeFile(path.join(dir, 'ok.ts'), 'const a = 1\nconsole.log(a)\n')
      const r = await runEngine(['bad.ts', 'ok.ts'], { cwd: dir })
      expect(r.degraded).toBe(false)
      expect(r.diagnostics).not.toBeNull()
      const hits = r.diagnostics!.filter(
        (d) => d.ruleId === 'lintsight-engine/no-eval'
      )
      expect(hits).toHaveLength(1)
      expect(hits[0].file).toBe('bad.ts')
      expect(hits[0].span.line).toBe(1)
      expect(r.diagnostics!.every((d) => d.file !== 'ok.ts')).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('engine-bridge: pipeline 集成（degraded 透传）', () => {
  test('引擎失败 → runPipeline 仍出纯 M1 结果且 degraded=true', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lintsight-engine-pipe-'))
    const restore = setEngineBin(path.join(dir, 'no-such-bin'))
    try {
      await writeFile(
        path.join(dir, '.oxlintrc.json'),
        JSON.stringify({ rules: { 'no-var': 'error' } })
      )
      await writeFile(path.join(dir, 'a.ts'), 'var a = 1\n')
      const r = await runPipeline(['.'], { cwd: dir })
      expect(r.exitCode).toBe(1)
      expect(r.degraded).toBe(true)
      expect(
        r.report?.diagnostics.some((d) => d.ruleId === 'eslint/no-var')
      ).toBe(true)
    } finally {
      restore()
      await rm(dir, { recursive: true, force: true })
    }
  })
})
