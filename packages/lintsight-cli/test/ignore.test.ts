/**
 * B1/B2 回归测试（docs/spikes/code-viewer-trial-v0.1.md §7）：
 * - B1：`ignore` 必须真正生效——含「cwd 在 A、被扫目标在 B（外部绝对路径）」形态。
 *   根因：oxlint 的 ignorePatterns 相对 oxlintrc 所在目录解析，而生成配置在
 *   .lintsight-cache/ 下一层 → 用户模式不可达（故改由 pipeline 侧过滤）。
 * - B2：常见构建产物默认不进扫描面（产物目录名 / 压缩文件名 / 打包产物长行形态），
 *   且可见（warn 日志）可关（ignoreGenerated: false）。
 */
import { describe, expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runPipeline } from '../src/pipeline'

const PROJECT_ROOT = new URL('../../../', import.meta.url).pathname

/** 含空 catch 的源码片段——被 lintsight/no-empty-catch 命中（用于断言「是否被扫描」） */
const BAD = 'try {\n  risky()\n} catch (e) {}\n'

/** 建一个可跑的最小项目（plugins 就位 + 可选 lintsight.config.json） */
async function makeProject(prefix: string, config?: unknown) {
  const dir = await mkdtemp(path.join(tmpdir(), prefix))
  await cp(path.join(PROJECT_ROOT, 'plugins'), path.join(dir, 'plugins'), {
    recursive: true
  })
  await writeFile(
    path.join(dir, 'lintsight.config.json'),
    JSON.stringify(config ?? { rules: { 'lintsight/no-empty-catch': 'error' } })
  )
  return dir
}

/** 命中自有规则 no-empty-catch 的文件清单（去重排序）。
 * 只认自有规则：临时项目里 plugins/ 产物与 eslint/no-empty 的同类诊断都不干扰判定。 */
function hitFiles(
  diagnostics: { ruleId: string; file: string }[],
  dir: string
): string[] {
  const files = diagnostics
    .filter((d) => d.ruleId === 'lintsight/no-empty-catch')
    .map((d) => d.file.replace(`${dir}/`, ''))
  return [...new Set(files)].sort()
}

describe('B1: ignore 配置生效', () => {
  test('ignore 目录 glob：项目根扫描时命中目录被排除（原失效路径的回归）', async () => {
    const dir = await makeProject('ls-b1-', {
      rules: { 'lintsight/no-empty-catch': 'error' },
      ignore: ['docs/assets/**']
    })
    try {
      await mkdir(path.join(dir, 'src'), { recursive: true })
      await mkdir(path.join(dir, 'docs/assets'), { recursive: true })
      await writeFile(path.join(dir, 'src/a.ts'), BAD)
      // 短行（非打包形态）→ 只可能被 B1 的 ignore 排除，确保测的是 B1 而非 B2 启发式
      await writeFile(
        path.join(dir, 'docs/assets/demo.js'),
        'try {\n  bundled()\n} catch (e) {}\n'
      )
      const r = await runPipeline(['.'], { cwd: dir, cache: false })
      expect(r.exitCode).toBe(1)
      // 被 ignore 的 docs/assets/demo.js 无任何诊断（修复前会命中 → 原失效路径的哨兵）
      expect(hitFiles(r.report!.diagnostics, dir)).toEqual(['src/a.ts'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('ignore 生效于外部绝对路径目标（cwd 与目标不同目录）', async () => {
    // host：cwd（含 plugins + 配置）；target：被扫的真实项目（外部路径）
    const host = await makeProject('ls-b1-host-', {
      rules: { 'lintsight/no-empty-catch': 'error' },
      ignore: ['docs/assets/**']
    })
    const target = await mkdtemp(path.join(tmpdir(), 'ls-b1-target-'))
    try {
      await mkdir(path.join(target, 'src'), { recursive: true })
      await mkdir(path.join(target, 'docs/assets'), { recursive: true })
      await writeFile(path.join(target, 'src/a.ts'), BAD)
      await writeFile(
        path.join(target, 'docs/assets/demo.js'),
        'try {\n  bundled()\n} catch (e) {}\n'
      )
      // 模式相对扫描根匹配 → 外部目标同样命中（oxlint 侧此形态下完全不可达）
      const r = await runPipeline([target], { cwd: host, cache: false })
      expect(r.exitCode).toBe(1)
      expect(r.report!.files).toBe(1) // target 无 plugins/ → 文件数即扫描面
      expect(hitFiles(r.report!.diagnostics, target)).toEqual(['src/a.ts'])
    } finally {
      await rm(host, { recursive: true, force: true })
      await rm(target, { recursive: true, force: true })
    }
  })

  test('ignore 目录名（无通配）按目录前缀生效', async () => {
    const dir = await makeProject('ls-b1-prefix-', {
      rules: { 'lintsight/no-empty-catch': 'error' },
      ignore: ['generated']
    })
    try {
      await mkdir(path.join(dir, 'generated/deep'), { recursive: true })
      await writeFile(path.join(dir, 'generated/deep/x.ts'), BAD)
      await writeFile(path.join(dir, 'keep.ts'), BAD)
      const r = await runPipeline(['.'], { cwd: dir, cache: false })
      expect(hitFiles(r.report!.diagnostics, dir)).toEqual(['keep.ts'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('非法 ignore 模式（..）不中断扫描（记 invalid 后继续）', async () => {
    const dir = await makeProject('ls-b1-invalid-', {
      rules: { 'lintsight/no-empty-catch': 'error' },
      ignore: ['../outside/**']
    })
    try {
      await writeFile(path.join(dir, 'a.ts'), BAD)
      const r = await runPipeline(['.'], { cwd: dir, cache: false })
      expect(r.exitCode).toBe(1)
      expect(hitFiles(r.report!.diagnostics, dir)).toEqual(['a.ts'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('B2: 构建产物默认忽略', () => {
  test('压缩文件名形态（*.min.js）与产物目录名默认排除', async () => {
    const dir = await makeProject('ls-b2-name-')
    try {
      await mkdir(path.join(dir, 'src'), { recursive: true })
      await mkdir(path.join(dir, 'compiled/dist'), { recursive: true })
      await mkdir(path.join(dir, 'coverage'), { recursive: true })
      await writeFile(path.join(dir, 'src/a.ts'), BAD)
      await writeFile(path.join(dir, 'compiled/lib.min.js'), BAD)
      await writeFile(path.join(dir, 'coverage/lcov.js'), BAD)
      const r = await runPipeline(['.'], { cwd: dir, cache: false })
      expect(hitFiles(r.report!.diagnostics, dir)).toEqual(['src/a.ts'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('打包产物长行形态（.js 单行 ≥1500）默认跳过，非配置的产物目录也覆盖', async () => {
    const dir = await makeProject('ls-b2-bundle-')
    try {
      await mkdir(path.join(dir, 'src'), { recursive: true })
      await mkdir(path.join(dir, 'docs/assets'), { recursive: true })
      await writeFile(path.join(dir, 'src/a.ts'), BAD)
      // 模拟 Vite 产物：极少数超长行（阈值 1500 经 corpus 实测校准）
      await writeFile(
        path.join(dir, 'docs/assets/index-ABC12345.js'),
        `try { ${'x'.repeat(1600)} } catch (e) {}\n`
      )
      const r = await runPipeline(['.'], { cwd: dir, cache: false })
      expect(r.exitCode).toBe(1)
      expect(hitFiles(r.report!.diagnostics, dir)).toEqual(['src/a.ts'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('阈值边界：长行 600 的 .js 仍扫描（阈值校准为 1500，避免误跳手写长行文件）', async () => {
    const dir = await makeProject('ls-b2-boundary-')
    try {
      // corpus 实测：手写长行文件（ghost 邮件模板/setup.js）最长 1316 → 不达阈值即扫描
      await writeFile(
        path.join(dir, 'long.js'),
        `const html = '${'z'.repeat(600)}'\n${BAD}`
      )
      const r = await runPipeline(['.'], { cwd: dir, cache: false })
      expect(hitFiles(r.report!.diagnostics, dir)).toEqual(['long.js'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('不误杀源码：.ts 长行 + 普通 .js 仍扫描（启发式仅对 JS 产物扩展名生效）', async () => {
    const dir = await makeProject('ls-b2-keep-')
    try {
      await writeFile(
        path.join(dir, 'long.ts'),
        `const s = '${'y'.repeat(600)}'\n${BAD}`
      )
      await writeFile(path.join(dir, 'normal.js'), BAD)
      const r = await runPipeline(['.'], { cwd: dir, cache: false })
      expect(hitFiles(r.report!.diagnostics, dir)).toEqual([
        'long.ts',
        'normal.js'
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('ignoreGenerated: false 关闭启发式（产物重新进扫描面）', async () => {
    const dir = await makeProject('ls-b2-off-', {
      rules: { 'lintsight/no-empty-catch': 'error' },
      ignoreGenerated: false
    })
    try {
      await mkdir(path.join(dir, 'src'), { recursive: true })
      await mkdir(path.join(dir, 'docs/assets'), { recursive: true })
      await writeFile(path.join(dir, 'src/a.ts'), BAD)
      // 该产物原本会被长行启发式跳过 → 关闭后应重新进扫描面
      await writeFile(
        path.join(dir, 'docs/assets/index-ABC12345.js'),
        `try { ${'x'.repeat(1600)} } catch (e) {}\n`
      )
      const r = await runPipeline(['.'], { cwd: dir, cache: false })
      expect(hitFiles(r.report!.diagnostics, dir)).toEqual([
        'docs/assets/index-ABC12345.js',
        'src/a.ts'
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
