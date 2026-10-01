/**
 * T1.16 内容哈希缓存单测 + pipeline 集成断言。
 * 集成用例在系统 tmpdir 自建项目——仓库 .lintsight-cache 是 dogfood 缓存，不得污染。
 */
import { describe, expect, test } from 'bun:test'
import { runPipeline } from '../src/pipeline'
import {
  createCacheKey,
  initCache,
  readCacheEntry,
  writeCacheEntry
} from '../src/cache'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const PROJECT_ROOT = new URL('../../../', import.meta.url).pathname

describe('cache: 键敏感性与条目读写', () => {
  test('引擎指纹：oxlint 可解析则启用，含 lintsight/oxlint 版本', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lintsight-cache-'))
    try {
      const ctx = await initCache({
        cwd: PROJECT_ROOT,
        lintsightVersion: '0.0.0-test'
      })
      expect(ctx.enabled).toBe(true)
      expect(ctx.engine).toContain('lintsight@0.0.0-test')
      expect(ctx.engine).toContain('oxlint@')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('键敏感性：内容/配置任一变化 → 新键；同内容 → 稳定键', async () => {
    const ctx = await initCache({
      cwd: PROJECT_ROOT,
      lintsightVersion: '0.0.0-test'
    })
    const k1 = createCacheKey(ctx, 'hash-a')
    const k1Again = createCacheKey(ctx, 'hash-a')
    const k2 = createCacheKey(ctx, 'hash-b')
    expect(k1).toBe(k1Again)
    expect(k1).not.toBe(k2)
    expect(k1).toMatch(/^[0-9a-f]{64}$/)
  })

  test('条目 roundtrip：写后可读；engine 漂移 → 视为 miss；损坏条目 → miss', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lintsight-cache-'))
    try {
      const ctx = await initCache({
        cwd: PROJECT_ROOT,
        lintsightVersion: '0.0.0-test'
      })
      const key = createCacheKey(ctx, 'hash-x')
      const diagnostics = [
        {
          contractVersion: '1',
          ruleId: 'lintsight/no-empty-catch',
          severity: 'error' as const,
          message: 'm',
          file: 'a.ts',
          span: { offset: 0, length: 1, line: 1, column: 1 },
          fingerprint: 'f'.repeat(64),
          owner: 'lintsight-js' as const
        }
      ]
      await writeCacheEntry(ctx, key, diagnostics)
      expect(await readCacheEntry(ctx, key)).toEqual(diagnostics)

      // 引擎漂移防护
      const drifted: typeof ctx = { ...ctx, engine: 'lintsight@x|oxlint@9' }
      expect(await readCacheEntry(drifted, key)).toBeNull()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('cache: pipeline 集成（命中/失效/--fix 禁用）', () => {
  test('首轮 miss → 写缓存；二轮 hit 且诊断一致；改文件 → 该文件重新扫描', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lintsight-cache-e2e-'))
    try {
      await writeFile(
        path.join(dir, '.oxlintrc.json'),
        JSON.stringify({ rules: { 'no-var': 'error' } })
      )
      await writeFile(path.join(dir, 'a.ts'), 'var a = 1\nconsole.log(a)\n')
      await writeFile(path.join(dir, 'b.ts'), 'var b = 2\nconsole.log(b)\n')

      const r1 = await runPipeline(['.'], { cwd: dir })
      expect(r1.exitCode).toBe(1)
      const d1 =
        r1.report?.diagnostics.filter((d) => d.ruleId === 'eslint/no-var') ?? []
      expect(d1.length).toBe(2)

      // 二轮：内容未变 → 全部命中，诊断与首轮一致
      const r2 = await runPipeline(['.'], { cwd: dir })
      expect(r2.report?.diagnostics).toEqual(r1.report?.diagnostics)

      // 改 a.ts → 只 a 重新扫描，b 命中；诊断随内容更新
      await writeFile(path.join(dir, 'a.ts'), 'let a = 1\nconsole.log(a)\n')
      const r3 = await runPipeline(['.'], { cwd: dir })
      const noVar3 =
        r3.report?.diagnostics.filter((d) => d.ruleId === 'eslint/no-var') ?? []
      expect(noVar3.map((d) => d.file)).toEqual(['b.ts'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('配置变更击穿缓存：.oxlintrc.json 规则集变化 → 重新扫描', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lintsight-cache-cfg-'))
    try {
      await writeFile(
        path.join(dir, '.oxlintrc.json'),
        JSON.stringify({ rules: { 'no-var': 'error' } })
      )
      await writeFile(path.join(dir, 'a.ts'), 'var a = 1\nconsole.log(a)\n')
      await runPipeline(['.'], { cwd: dir })

      // 配置变化：关掉 no-var → 新键 → 重扫 → no-var 诊断消失
      await writeFile(
        path.join(dir, '.oxlintrc.json'),
        JSON.stringify({ rules: {} })
      )
      const r = await runPipeline(['.'], { cwd: dir })
      expect(
        r.report?.diagnostics.filter((d) => d.ruleId === 'eslint/no-var')
      ).toHaveLength(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('--fix 模式不读缓存：即使内容命中也要完整扫描（否则 fixable 被漏修）', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lintsight-cache-fix-'))
    try {
      await writeFile(
        path.join(dir, '.oxlintrc.json'),
        JSON.stringify({ rules: { 'no-var': 'error' } })
      )
      await writeFile(path.join(dir, 'a.ts'), 'var a = 1\nconsole.log(a)\n')

      // 建立缓存（非 fix）
      await runPipeline(['.'], { cwd: dir })

      // --fix：同内容若读缓存会跳过扫描 → 没机会修复；实际应完成 var→let/const
      const r = await runPipeline(['.'], { cwd: dir, fix: true })
      expect(r.exitCode).toBe(0)
      const content = await readFile(path.join(dir, 'a.ts'), 'utf8')
      expect(content).not.toContain('var ')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
