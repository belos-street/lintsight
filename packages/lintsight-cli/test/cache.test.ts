/**
 * T1.16 内容哈希缓存单测 + pipeline 集成断言（G1 8 组矩阵）。
 * 集成用例在系统 tmpdir 自建项目——仓库 .lintsight-cache 是 dogfood 缓存，不得污染。
 * 图规则/tsconfig 冷热等价用例依赖 cargo release 产物，未构建时自动跳过。
 */
import { describe, expect, test } from 'bun:test'
import { runPipeline } from '../src/pipeline'
import {
  createCacheKey,
  initCache,
  readCacheEntry,
  writeCacheEntry
} from '../src/cache'
import { resolveEngineBin } from '../src/engine-bridge'
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  unlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const engineBin = resolveEngineBin(PROJECT_ROOT)
/** CI 设 REQUIRE_ENGINE=1：引擎矩阵不得静默 skip（无 cargo release 产物即失败） */
const REQUIRE_ENGINE = process.env.REQUIRE_ENGINE === '1'

function setEngineBin(value: string | undefined): () => void {
  const prev = process.env.OXLINT_ENGINE_BIN
  if (value === undefined) delete process.env.OXLINT_ENGINE_BIN
  else process.env.OXLINT_ENGINE_BIN = value
  return () => {
    if (prev === undefined) delete process.env.OXLINT_ENGINE_BIN
    else process.env.OXLINT_ENGINE_BIN = prev
  }
}

async function tempProject(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix))
}

async function writeOxlintrc(
  dir: string,
  rules: Record<string, unknown>
): Promise<void> {
  await writeFile(path.join(dir, '.oxlintrc.json'), JSON.stringify({ rules }))
}

function diagnosticsOf(
  r: Awaited<ReturnType<typeof runPipeline>>,
  ruleId: string
) {
  return r.report?.diagnostics.filter((d) => d.ruleId === ruleId) ?? []
}

/** 缓存条目文件（.json；tmp 残留不计） */
async function cacheEntryPaths(dir: string): Promise<string[]> {
  const cacheDir = path.join(dir, '.lintsight-cache', 'cache')
  try {
    return (await readdir(cacheDir))
      .filter((f) => f.endsWith('.json'))
      .map((f) => path.join(cacheDir, f))
  } catch {
    return []
  }
}

describe('cache: 引擎矩阵前置条件', () => {
  test('REQUIRE_ENGINE=1 时必须有 cargo release 引擎产物', () => {
    if (REQUIRE_ENGINE) expect(engineBin).not.toBeNull()
  })
})

describe('cache: 键敏感性与条目读写', () => {
  test('引擎指纹：oxlint 可解析则启用，含 lintsight/oxlint 版本', async () => {
    const dir = await tempProject('lintsight-cache-')
    try {
      const ctx = await initCache({
        cwd: dir,
        lintsightVersion: '0.0.0-test'
      })
      expect(ctx.enabled).toBe(true)
      expect(ctx.engine).toContain('lintsight@0.0.0-test')
      expect(ctx.engine).toContain('oxlint@')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('键敏感性：路径/内容任一变化 → 新键；同路径同内容 → 稳定键', async () => {
    const dir = await tempProject('lintsight-cache-key-')
    try {
      const ctx = await initCache({
        cwd: dir,
        lintsightVersion: '0.0.0-test'
      })
      const k = createCacheKey(ctx, 'src/a.ts', 'hash-a')
      expect(createCacheKey(ctx, 'src/a.ts', 'hash-a')).toBe(k)
      expect(createCacheKey(ctx, 'src/b.ts', 'hash-a')).not.toBe(k)
      expect(createCacheKey(ctx, 'src/a.ts', 'hash-b')).not.toBe(k)
      expect(k).toMatch(/^[0-9a-f]{64}$/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('条目 roundtrip：写后可读；空数组可命中；engine 漂移/损坏条目 → miss', async () => {
    const dir = await tempProject('lintsight-cache-entry-')
    try {
      const ctx = await initCache({
        cwd: dir,
        lintsightVersion: '0.0.0-test'
      })
      const key = createCacheKey(ctx, 'a.ts', 'hash-x')
      const diagnostics = [
        {
          contractVersion: '3',
          ruleId: 'lintsight/no-empty-catch',
          severity: 'error' as const,
          message: 'm',
          file: 'a.ts',
          span: { offset: 0, length: 1, line: 1, column: 1 },
          fingerprint: 'f'.repeat(64),
          owner: 'lintsight-js' as const,
          confidence: 'high' as const,
          cweTags: []
        }
      ]
      await writeCacheEntry(ctx, key, diagnostics)
      expect(await readCacheEntry(ctx, key)).toEqual(diagnostics)

      // 空结果（干净文件）也是合法条目
      const cleanKey = createCacheKey(ctx, 'clean.ts', 'hash-clean')
      await writeCacheEntry(ctx, cleanKey, [])
      expect(await readCacheEntry(ctx, cleanKey)).toEqual([])

      // 引擎漂移防护
      const drifted: typeof ctx = { ...ctx, engine: 'lintsight@x|oxlint@9' }
      expect(await readCacheEntry(drifted, key)).toBeNull()

      // 损坏条目 → miss
      await writeFile(
        path.join(dir, '.lintsight-cache', 'cache', `${key}.json`),
        '{'
      )
      expect(await readCacheEntry(ctx, key)).toBeNull()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('引擎版本指纹变化：lintsightVersion / engine bin 内容 → 新键', async () => {
    const dir = await tempProject('lintsight-cache-engine-')
    try {
      const bin = path.join(dir, 'engine.bin')
      await writeFile(bin, 'v1')
      const ctx1 = await initCache({
        cwd: dir,
        lintsightVersion: '0.0.0-a',
        engineBin: bin
      })
      const key1 = createCacheKey(ctx1, 'a.ts', 'hash-a')

      const ctxVersion = await initCache({
        cwd: dir,
        lintsightVersion: '0.0.0-b',
        engineBin: bin
      })
      expect(createCacheKey(ctxVersion, 'a.ts', 'hash-a')).not.toBe(key1)

      await writeFile(bin, 'v2')
      const ctxBin = await initCache({
        cwd: dir,
        lintsightVersion: '0.0.0-a',
        engineBin: bin
      })
      expect(ctxBin.engine).not.toBe(ctx1.engine)
      expect(createCacheKey(ctxBin, 'a.ts', 'hash-a')).not.toBe(key1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('插件产物内容变化击穿：jsPlugins 相对路径按配置目录解析', async () => {
    const dir = await tempProject('lintsight-cache-plugin-')
    try {
      const rc = path.join(dir, 'custom.oxlintrc.json')
      const plugin = path.join(dir, 'plugin.js')
      await writeFile(plugin, 'export default { rules: {} }\n')
      await writeFile(
        rc,
        JSON.stringify({ jsPlugins: ['./plugin.js'], rules: {} })
      )
      const ctx1 = await initCache({
        cwd: dir,
        oxlintrcPath: rc,
        lintsightVersion: '0.0.0-test'
      })
      expect(ctx1.enabled).toBe(true)
      expect(ctx1.plugin).not.toContain('missing')
      const key1 = createCacheKey(ctx1, 'a.ts', 'hash-a')

      await writeFile(plugin, 'export default { rules: { x: 1 } }\n')
      const ctx2 = await initCache({
        cwd: dir,
        oxlintrcPath: rc,
        lintsightVersion: '0.0.0-test'
      })
      expect(ctx2.plugin).not.toBe(ctx1.plugin)
      expect(createCacheKey(ctx2, 'a.ts', 'hash-a')).not.toBe(key1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('手写 .oxlintrc.json 的 jsPlugins 相对路径：oxlint 实际加载（相对配置目录解析）', async () => {
    const dir = await tempProject('lintsight-cache-plugin-e2e-')
    try {
      await cp(
        path.join(PROJECT_ROOT, 'plugins/lintsight-rules/index.js'),
        path.join(dir, 'plugin.js')
      )
      await writeFile(
        path.join(dir, '.oxlintrc.json'),
        JSON.stringify({
          jsPlugins: ['./plugin.js'],
          rules: { 'lintsight/no-empty-catch': 'error' }
        })
      )
      await writeFile(path.join(dir, 'a.ts'), 'try { foo() } catch {}\n')
      const r = await runPipeline(['.'], { cwd: dir, cache: false })
      expect(diagnosticsOf(r, 'lintsight/no-empty-catch')).toHaveLength(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('tsconfig 内容变化 → config 指纹变化', async () => {
    const dir = await tempProject('lintsight-cache-tsconfig-')
    try {
      const ts = path.join(dir, 'tsconfig.json')
      await writeFile(
        ts,
        JSON.stringify({ compilerOptions: { paths: { '@/*': ['src/one/*'] } } })
      )
      const ctx1 = await initCache({
        cwd: dir,
        lintsightVersion: '0.0.0-test',
        tsconfigFiles: [ts]
      })
      const key1 = createCacheKey(ctx1, 'a.ts', 'hash-a')

      await writeFile(
        ts,
        JSON.stringify({ compilerOptions: { paths: { '@/*': ['src/two/*'] } } })
      )
      const ctx2 = await initCache({
        cwd: dir,
        lintsightVersion: '0.0.0-test',
        tsconfigFiles: [ts]
      })
      expect(ctx2.config).not.toBe(ctx1.config)
      expect(createCacheKey(ctx2, 'a.ts', 'hash-a')).not.toBe(key1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('同 key 并发写入：条目始终完整可解析', async () => {
    const dir = await tempProject('lintsight-cache-atomic-')
    try {
      const ctx = await initCache({
        cwd: dir,
        lintsightVersion: '0.0.0-test'
      })
      const key = createCacheKey(ctx, 'a.ts', 'hash-a')
      const payload = (i: number) => [
        {
          contractVersion: '3',
          ruleId: 'lintsight/no-empty-catch',
          severity: 'error' as const,
          message: `m${i}`,
          file: 'a.ts',
          span: { offset: 0, length: 1, line: 1, column: 1 },
          fingerprint: `${i}`.padEnd(64, '0'),
          owner: 'lintsight-js' as const,
          confidence: 'high' as const,
          cweTags: []
        }
      ]
      const payloads = Array.from({ length: 8 }, (_, i) => payload(i))
      // 种下版本 0：并发读者至少能读到完整旧文件
      await writeCacheEntry(ctx, key, payloads[0])
      const writes = payloads.slice(1).map((p) => writeCacheEntry(ctx, key, p))
      const reads = Array.from({ length: 20 }, async () => {
        const got = await readCacheEntry(ctx, key)
        expect(got).not.toBeNull()
        const complete = payloads.some(
          (p) => JSON.stringify(p) === JSON.stringify(got)
        )
        expect(complete).toBe(true)
      })
      await Promise.all([...writes, ...reads])
      expect(await readCacheEntry(ctx, key)).not.toBeNull()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('cache: pipeline 集成（G1 矩阵 1/2/3/5）', () => {
  test('同内容不同路径：诊断归属各自文件，冷/热一致', async () => {
    const dir = await tempProject('lintsight-cache-paths-')
    try {
      await writeOxlintrc(dir, { 'no-var': 'error' })
      await mkdir(path.join(dir, 'one'))
      await mkdir(path.join(dir, 'two'))
      const content = 'var a = 1\nconsole.log(a)\n'
      await writeFile(path.join(dir, 'one/a.ts'), content)
      await writeFile(path.join(dir, 'two/a.ts'), content)

      const r1 = await runPipeline(['.'], { cwd: dir })
      expect(
        diagnosticsOf(r1, 'eslint/no-var')
          .map((d) => d.file)
          .sort()
      ).toEqual(['one/a.ts', 'two/a.ts'])
      expect(r1.cache).toEqual({ enabled: true, hits: 0, misses: 2 })

      const r2 = await runPipeline(['.'], { cwd: dir })
      expect(r2.cache).toEqual({ enabled: true, hits: 2, misses: 0 })
      expect(r2.report?.diagnostics).toEqual(r1.report?.diagnostics)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('干净文件空结果入缓存：二轮全 hit', async () => {
    const dir = await tempProject('lintsight-cache-clean-')
    try {
      await writeOxlintrc(dir, { 'no-var': 'error' })
      await writeFile(path.join(dir, 'bad.ts'), 'var bad = 1\n')
      await writeFile(
        path.join(dir, 'clean.ts'),
        'const ok = 1\nconsole.log(ok)\n'
      )

      const r1 = await runPipeline(['.'], { cwd: dir })
      expect(r1.cache).toEqual({ enabled: true, hits: 0, misses: 2 })
      expect(diagnosticsOf(r1, 'eslint/no-var').map((d) => d.file)).toEqual([
        'bad.ts'
      ])
      // 干净文件也落了条目（2 个文件 = 2 个条目）
      expect(await cacheEntryPaths(dir)).toHaveLength(2)

      const r2 = await runPipeline(['.'], { cwd: dir })
      expect(r2.cache).toEqual({ enabled: true, hits: 2, misses: 0 })
      expect(r2.report?.diagnostics).toEqual(r1.report?.diagnostics)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('文件删除后不命中旧条目：诊断不含已删文件', async () => {
    const dir = await tempProject('lintsight-cache-unlink-')
    try {
      await writeOxlintrc(dir, { 'no-var': 'error' })
      await writeFile(path.join(dir, 'a.ts'), 'var a = 1\n')
      await writeFile(path.join(dir, 'b.ts'), 'var b = 2\n')

      const r1 = await runPipeline(['.'], { cwd: dir })
      expect(r1.cache).toEqual({ enabled: true, hits: 0, misses: 2 })

      await unlink(path.join(dir, 'b.ts'))
      const r2 = await runPipeline(['.'], { cwd: dir })
      expect(r2.cache).toEqual({ enabled: true, hits: 1, misses: 0 })
      expect(diagnosticsOf(r2, 'eslint/no-var').map((d) => d.file)).toEqual([
        'a.ts'
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('配置变更击穿缓存：.oxlintrc.json 规则集变化 → 重新扫描', async () => {
    const dir = await tempProject('lintsight-cache-cfg-')
    try {
      await writeOxlintrc(dir, { 'no-var': 'error' })
      await writeFile(path.join(dir, 'a.ts'), 'var a = 1\nconsole.log(a)\n')
      await runPipeline(['.'], { cwd: dir })

      // 配置变化：关掉 no-var → 新键 → 重扫 → no-var 诊断消失
      await writeOxlintrc(dir, {})
      const r = await runPipeline(['.'], { cwd: dir })
      expect(diagnosticsOf(r, 'eslint/no-var')).toHaveLength(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('--no-cache 与 cache 冷/热诊断集合一致', async () => {
    const dir = await tempProject('lintsight-cache-consistency-')
    try {
      await writeOxlintrc(dir, { 'no-var': 'error' })
      await writeFile(path.join(dir, 'a.ts'), 'var a = 1\n')
      await writeFile(path.join(dir, 'b.ts'), 'var b = 2\n')

      const cold = await runPipeline(['.'], { cwd: dir })
      const hot = await runPipeline(['.'], { cwd: dir })
      const noCache = await runPipeline(['.'], { cwd: dir, cache: false })
      expect(hot.report?.diagnostics).toEqual(cold.report?.diagnostics)
      expect(noCache.report?.diagnostics).toEqual(cold.report?.diagnostics)
      expect(noCache.cache).toEqual({ enabled: false, hits: 0, misses: 2 })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('--fix 模式不读缓存：即使内容命中也要完整扫描（否则 fixable 被漏修）', async () => {
    const dir = await tempProject('lintsight-cache-fix-')
    try {
      await writeOxlintrc(dir, { 'no-var': 'error' })
      await writeFile(path.join(dir, 'a.ts'), 'var a = 1\nconsole.log(a)\n')

      // 建立缓存（非 fix）
      await runPipeline(['.'], { cwd: dir })

      // --fix：同内容若读缓存会跳过扫描 → 没机会修复；实际应完成 var→let/const
      const r = await runPipeline(['.'], { cwd: dir, fix: true })
      expect(r.exitCode).toBe(0)
      const content = await readFile(path.join(dir, 'a.ts'), 'utf8')
      expect(content).not.toContain('var ')
      expect(r.cache).toEqual({ enabled: false, hits: 0, misses: 1 })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('并发 runPipeline：两轮结果一致且缓存可读', async () => {
    const dir = await tempProject('lintsight-cache-concurrent-')
    try {
      await writeOxlintrc(dir, { 'no-var': 'error' })
      await writeFile(path.join(dir, 'a.ts'), 'var a = 1\n')
      await writeFile(path.join(dir, 'b.ts'), 'var b = 2\n')

      const [r1, r2] = await Promise.all([
        runPipeline(['.'], { cwd: dir }),
        runPipeline(['.'], { cwd: dir })
      ])
      expect(r1.report?.diagnostics).toEqual(r2.report?.diagnostics)

      const r3 = await runPipeline(['.'], { cwd: dir })
      expect(r3.report?.diagnostics).toEqual(r1.report?.diagnostics)
      // 并发写入后每个条目仍是完整 JSON（tmp+rename 原子发布）
      const entries = await cacheEntryPaths(dir)
      expect(entries.length).toBe(2)
      await Promise.all(
        entries.map(async (f) => {
          const raw = await readFile(f, 'utf8')
          expect(() => JSON.parse(raw)).not.toThrow()
        })
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe.skipIf(!engineBin)('cache: 引擎降级不毒化（真实引擎）', () => {
  test('引擎降级期间写 M1 缓存，恢复后引擎诊断仍出现', async () => {
    const dir = await tempProject('lintsight-cache-degraded-')
    const restore = setEngineBin(path.join(dir, 'no-such-engine'))
    try {
      await writeOxlintrc(dir, { 'no-var': 'error' })
      await writeFile(path.join(dir, 'a.ts'), 'eval("1")\nvar a = 1\n')

      const r1 = await runPipeline(['.'], { cwd: dir })
      expect(r1.degraded).toBe(true)
      expect(diagnosticsOf(r1, 'lintsight-engine/no-eval')).toHaveLength(0)
      expect(diagnosticsOf(r1, 'eslint/no-var')).toHaveLength(1)

      // 降级轮写下的条目只含 M1 诊断（引擎结果不落盘）
      const entries = await cacheEntryPaths(dir)
      expect(entries.length).toBeGreaterThan(0)
      await Promise.all(
        entries.map(async (f) => {
          const entry = JSON.parse(await readFile(f, 'utf8')) as {
            diagnostics: { owner: string }[]
          }
          // 引擎结果不得落盘：条目里不允许出现 lintsight-engine 归属的诊断
          expect(
            entry.diagnostics.every((d) => d.owner !== 'lintsight-engine')
          ).toBe(true)
        })
      )
    } finally {
      restore()
    }

    try {
      const r2 = await runPipeline(['.'], { cwd: dir })
      expect(r2.degraded).toBe(false)
      expect(diagnosticsOf(r2, 'lintsight-engine/no-eval')).toHaveLength(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe.skipIf(!engineBin)('cache: 图规则冷热等价（真实引擎）', () => {
  async function graphProject(prefix: string): Promise<string> {
    const dir = await tempProject(prefix)
    await cp(path.join(PROJECT_ROOT, 'plugins'), path.join(dir, 'plugins'), {
      recursive: true
    })
    await mkdir(path.join(dir, 'src'))
    await writeFile(
      path.join(dir, 'lintsight.config.json'),
      JSON.stringify({ rules: {}, arch: { zones: [], importCycles: true } })
    )
    return dir
  }

  test('图规则冷热等价：成环 / 断环 / 加文件（importCycles）', async () => {
    const dir = await graphProject('lintsight-cache-graph-')
    const cycles = async (cache = true) => {
      const r = await runPipeline(['.'], { cwd: dir, cache })
      return diagnosticsOf(r, 'lintsight-engine/no-import-cycle')
    }
    try {
      await writeFile(
        path.join(dir, 'src/a.ts'),
        "import { b } from './b'\nexport const a = 1\n"
      )
      await writeFile(
        path.join(dir, 'src/b.ts'),
        "import { a } from './a'\nexport const b = 2\n"
      )

      const cold1 = await cycles()
      expect(cold1).toHaveLength(2)
      expect(cold1.map((d) => d.file).sort()).toEqual(['src/a.ts', 'src/b.ts'])
      expect(await cycles()).toEqual(cold1)
      expect(await cycles(false)).toEqual(cold1)

      // 断环：b 不再 import a → 冷/热均为 0（不得复用旧环条目）
      await writeFile(path.join(dir, 'src/b.ts'), 'export const b = 2\n')
      expect(await cycles()).toHaveLength(0)
      expect(await cycles()).toHaveLength(0)

      // 加文件成三节点环：a → b → c → a
      await writeFile(
        path.join(dir, 'src/b.ts'),
        "import { c } from './c'\nexport const b = 2\n"
      )
      await writeFile(
        path.join(dir, 'src/c.ts'),
        "import { a } from './a'\nexport const c = 3\n"
      )
      const cold3 = await cycles()
      expect(cold3).toHaveLength(3)
      expect(cold3.map((d) => d.file).sort()).toEqual([
        'src/a.ts',
        'src/b.ts',
        'src/c.ts'
      ])
      expect(await cycles()).toEqual(cold3)
      expect(await cycles(false)).toEqual(cold3)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('tsconfig 别名变化冷热等价：别名解析成环', async () => {
    const dir = await graphProject('lintsight-cache-ts-alias-')
    const cycles = async (cache = true) => {
      const r = await runPipeline(['.'], { cwd: dir, cache })
      return diagnosticsOf(r, 'lintsight-engine/no-import-cycle')
    }
    try {
      await writeFile(
        path.join(dir, 'src/a.ts'),
        "import { b } from './b'\nexport const a = 1\n"
      )
      await writeFile(
        path.join(dir, 'src/b.ts'),
        "import { a } from '@/a'\nexport const b = 2\n"
      )

      // 无 tsconfig：`@/a` 是裸说明符 → 不解析 → 无环
      expect(await cycles()).toHaveLength(0)
      expect(await cycles()).toHaveLength(0)

      // 新增 tsconfig paths（源码不变）→ 别名解析成环 → 热扫必须得到 2 条
      await writeFile(
        path.join(dir, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            baseUrl: '.',
            paths: { '@/*': ['src/*'] }
          }
        })
      )
      const cold = await cycles()
      expect(cold).toHaveLength(2)
      expect(cold.map((d) => d.file).sort()).toEqual(['src/a.ts', 'src/b.ts'])
      expect(await cycles()).toEqual(cold)
      expect(await cycles(false)).toEqual(cold)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
