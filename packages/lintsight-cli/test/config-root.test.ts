/**
 * G13 配置根与路径契约：--root / --config 相对 root / 外部绝对路径报告。
 */
import { describe, expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runPipeline } from '../src/pipeline'

const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url))

async function makeProject(prefix: string, config: unknown): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix))
  await cp(path.join(PROJECT_ROOT, 'plugins'), path.join(dir, 'plugins'), {
    recursive: true
  })
  await mkdir(path.join(dir, 'src'), { recursive: true })
  await writeFile(
    path.join(dir, 'lintsight.config.json'),
    JSON.stringify(config)
  )
  await writeFile(
    path.join(dir, 'src/a.ts'),
    'var a = 1\ntry { foo() } catch {}\n'
  )
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

function hasAbsolutePath(file: string): boolean {
  return (
    file.startsWith('C:/') || file.startsWith('/Users/') || file.startsWith('/')
  )
}

describe('G13 配置根：pipeline root', () => {
  test('外部绝对路径 root：config 来自目标、报告 file 相对、缓存落目标', async () => {
    const dir = await makeProject('lintsight-root-ext-', {
      rules: { 'lintsight/no-empty-catch': 'error' }
    })
    try {
      const r = await runPipeline(['.'], {
        cwd: PROJECT_ROOT,
        root: dir,
        cache: false
      })
      const own =
        r.report?.diagnostics.filter(
          (d) => d.ruleId === 'lintsight/no-empty-catch'
        ) ?? []
      expect(own.length).toBeGreaterThan(0)
      expect(own[0].file).toBe('src/a.ts')
      expect(hasAbsolutePath(own[0].file)).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('嵌套 --config 相对 root 解析', async () => {
    const dir = await makeProject('lintsight-root-nested-', {
      rules: {}
    })
    try {
      await mkdir(path.join(dir, 'config'), { recursive: true })
      await writeFile(
        path.join(dir, 'config/custom.json'),
        JSON.stringify({ rules: { 'lintsight/no-empty-catch': 'error' } })
      )
      const r = await runPipeline(['.'], {
        cwd: PROJECT_ROOT,
        root: dir,
        config: 'config/custom.json',
        cache: false
      })
      expect(
        r.report?.diagnostics.some(
          (d) => d.ruleId === 'lintsight/no-empty-catch'
        )
      ).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('显式 --config 覆盖 root 默认配置', async () => {
    const dir = await makeProject('lintsight-root-override-', {
      rules: { 'no-var': 'error' }
    })
    try {
      await writeFile(
        path.join(dir, 'alt.json'),
        JSON.stringify({ rules: { 'lintsight/no-empty-catch': 'error' } })
      )
      const r = await runPipeline(['.'], {
        cwd: PROJECT_ROOT,
        root: dir,
        config: 'alt.json',
        cache: false
      })
      expect(
        r.report?.diagnostics.some(
          (d) => d.ruleId === 'lintsight/no-empty-catch'
        )
      ).toBe(true)
      expect(
        r.report?.diagnostics.some((d) => d.ruleId === 'eslint/no-var')
      ).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('root 相对 ignore：dist/** 不进入报告', async () => {
    const dir = await makeProject('lintsight-root-ignore-', {
      rules: { 'lintsight/no-empty-catch': 'error' },
      ignore: ['dist/**']
    })
    try {
      await mkdir(path.join(dir, 'dist'), { recursive: true })
      await writeFile(
        path.join(dir, 'dist/skip.ts'),
        'try { foo() } catch {}\n'
      )
      const r = await runPipeline(['.'], {
        cwd: PROJECT_ROOT,
        root: dir,
        cache: false
      })
      const own =
        r.report?.diagnostics.filter(
          (d) => d.ruleId === 'lintsight/no-empty-catch'
        ) ?? []
      expect(own.some((d) => d.file === 'src/a.ts')).toBe(true)
      expect(own.some((d) => d.file === 'dist/skip.ts')).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('root 下 .vue 虚拟块回映射与行内抑制', async () => {
    const dir = await makeProject('lintsight-root-vue-', {
      rules: { 'lintsight/no-empty-catch': 'error' }
    })
    try {
      await writeFile(
        path.join(dir, 'src/comp.vue'),
        [
          '<template>',
          '  <div />',
          '</template>',
          '',
          '<script>',
          'try { one() } catch {}',
          '// lintsight-ignore-next-line lintsight/no-empty-catch: vue-mapped',
          'try { two() } catch {}',
          '</script>',
          ''
        ].join('\n')
      )
      const r = await runPipeline(['.'], {
        cwd: PROJECT_ROOT,
        root: dir,
        cache: false
      })
      const own =
        r.report?.diagnostics.filter(
          (d) =>
            d.ruleId === 'lintsight/no-empty-catch' &&
            d.file === 'src/comp.vue' &&
            !d.suppression
        ) ?? []
      expect(own).toHaveLength(1)
      expect(own[0].file).toBe('src/comp.vue')
      expect(own[0].span.line).toBe(6)
      expect(r.report?.summary.suppressed).toBe(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('root 不存在 / 不是目录 → exit 2', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lintsight-root-invalid-'))
    try {
      const missing = await runPipeline(['.'], {
        cwd: PROJECT_ROOT,
        root: path.join(dir, 'nope')
      })
      expect(missing.exitCode).toBe(2)
      expect(missing.error).toContain('root path not found')

      await writeFile(path.join(dir, 'file.txt'), 'x')
      const notDir = await runPipeline(['.'], {
        cwd: PROJECT_ROOT,
        root: path.join(dir, 'file.txt')
      })
      expect(notDir.exitCode).toBe(2)
      expect(notDir.error).toContain('root is not a directory')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('G13 配置根：CLI', () => {
  test('--root：外部项目配置与相对报告路径；缓存落目标', async () => {
    const dir = await makeProject('lintsight-root-cli-', {
      rules: { 'lintsight/no-empty-catch': 'error' }
    })
    try {
      const r = await spawnCli(PROJECT_ROOT, [
        '.',
        '--root',
        dir,
        '--format',
        'json'
      ])
      expect(r.code).toBe(1)
      const report = JSON.parse(r.stdout)
      const own = report.diagnostics.filter(
        (d: { ruleId: string }) => d.ruleId === 'lintsight/no-empty-catch'
      )
      expect(own[0].file).toBe('src/a.ts')
      expect(own[0].file).not.toMatch(/^C:\//)
      expect(await readdir(path.join(dir, '.lintsight-cache'))).toContain(
        'cache'
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('--root 缺值 / 不存在 → exit 2', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lintsight-root-cli-bad-'))
    try {
      const missingValue = await spawnCli(dir, ['.', '--root'])
      expect(missingValue.code).toBe(2)
      expect(missingValue.stderr).toContain('--root 缺少取值')

      // 后接另一个选项（--output）不能被当成 root 值
      const optionAsValue = await spawnCli(dir, [
        '.',
        '--root',
        '--output',
        'report.json'
      ])
      expect(optionAsValue.code).toBe(2)
      expect(optionAsValue.stderr).toContain('--root 缺少取值')

      const notFound = await spawnCli(dir, [
        '.',
        '--root',
        path.join(dir, 'nope')
      ])
      expect(notFound.code).toBe(2)
      expect(notFound.stderr).toContain('root path not found')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('root 外输入：保留原路径并告警', async () => {
    const dir = await makeProject('lintsight-root-outside-', {
      rules: { 'lintsight/no-empty-catch': 'error' }
    })
    const outside = await mkdtemp(
      path.join(tmpdir(), 'lintsight-root-ext-file-')
    )
    try {
      const ext = path.join(outside, 'ext.ts')
      await writeFile(ext, 'try { foo() } catch {}\n')
      const r = await spawnCli(PROJECT_ROOT, [
        ext,
        '--root',
        dir,
        '--format',
        'json',
        '--log-level',
        'warn'
      ])
      expect(r.code).toBe(1)
      expect(r.stderr).toContain('在 root 之外')
      const report = JSON.parse(r.stdout) as {
        diagnostics: { ruleId: string; file: string }[]
      }
      const extDiag = report.diagnostics.find(
        (d) =>
          d.ruleId === 'lintsight/no-empty-catch' && d.file.includes('ext.ts')
      )
      expect(extDiag).toBeDefined()
      expect(path.isAbsolute(extDiag!.file)).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })

  test('--output 按调用方 cwd 落盘（不是 root）', async () => {
    const dir = await makeProject('lintsight-root-output-', {
      rules: { 'lintsight/no-empty-catch': 'error' }
    })
    const caller = await mkdtemp(path.join(tmpdir(), 'lintsight-root-caller-'))
    try {
      const r = await spawnCli(caller, [
        '.',
        '--root',
        dir,
        '--format',
        'json',
        '--output',
        'report.json'
      ])
      expect(r.code).toBe(1)
      expect(r.stdout).toBe('')
      expect(await Bun.file(path.join(caller, 'report.json')).exists()).toBe(
        true
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
      await rm(caller, { recursive: true, force: true })
    }
  })
})
