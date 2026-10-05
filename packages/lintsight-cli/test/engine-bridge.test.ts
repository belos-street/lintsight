/**
 * T2.1 M2 引擎桥接测试（design-m2 §4.3）：fail-open 降级路径 + spawn 联通 + pipeline 集成。
 * 联通用例依赖 cargo release 产物（crates/lintsight-engine/target/release/），未构建时自动跳过；
 * 降级用例通过 OXLINT_ENGINE_BIN 注入假二进制（不存在 / 协议损坏）。
 */
import { describe, expect, test } from 'bun:test'
import { chmod, cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  resolveEngineBin,
  resolveTsPaths,
  runEngine
} from '../src/engine-bridge'
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

  test('rayon 并行确定性（T2.6）：多文件多次运行输出一致', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lintsight-engine-det-'))
    try {
      const files = Array.from({ length: 12 }, (_, i) => `f${i}.ts`)
      await Promise.all(
        files.map((name, i) =>
          writeFile(
            path.join(dir, name),
            i % 3 === 0 ? `eval("x${i}")\n` : `const a${i} = ${i}\n`
          )
        )
      )
      const r1 = await runEngine(files, { cwd: dir })
      const r2 = await runEngine(files, { cwd: dir })
      expect(r1.degraded).toBe(false)
      // JSON Lines 输出确定性：par_iter 保序 collect，与串行一致（M1-DR4）
      expect(JSON.stringify(r2.diagnostics)).toBe(
        JSON.stringify(r1.diagnostics)
      )
      expect(r1.diagnostics).toHaveLength(4) // i%3===0 的 4 个文件命中 eval
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

describe('engine-bridge: 双报消解集成（T2.5 supersedes）', () => {
  test('no-path-traversal 命中行抑制 no-non-literal-fs-filename，他行保留', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lintsight-supersede-'))
    try {
      // jsPlugins 直指 monorepo 产物（业务项目 node_modules 形态的等价短路）
      await writeFile(
        path.join(dir, '.oxlintrc.json'),
        JSON.stringify({
          jsPlugins: [
            new URL(
              '../../../plugins/lintsight-rules/index.js',
              import.meta.url
            ).pathname
          ],
          rules: { 'lintsight/no-non-literal-fs-filename': 'warn' }
        })
      )
      await writeFile(
        path.join(dir, 'db.ts'),
        `import fs from 'node:fs'
import path from 'node:path'
const files = fs.readdirSync('./data')
for (const filePath of files) {
  fs.readFileSync(path.join('./data', filePath))
}
const externalFilePath = process.argv[2]
fs.readFileSync(externalFilePath)
`
      )
      const r = await runPipeline(['.'], { cwd: dir })
      const engine =
        r.report?.diagnostics.filter(
          (d) => d.ruleId === 'lintsight-engine/no-path-traversal'
        ) ?? []
      const js =
        r.report?.diagnostics.filter(
          (d) => d.ruleId === 'lintsight/no-non-literal-fs-filename'
        ) ?? []
      expect(engine).toHaveLength(1)
      expect(engine[0].span.line).toBe(5)
      // L5 的 JS 版被 engine 版抑制（同文件同行）；L8 无 engine 命中 → 保留
      expect(js).toHaveLength(1)
      expect(js[0].span.line).toBe(8)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('engine-bridge: arch 规则集成（T2.4）', () => {
  test('resolveTsPaths：JSONC tsconfig → best-match 排序映射表；fail-open', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lintsight-tspaths-'))
    try {
      // JSONC（注释 + 尾逗号）+ baseUrl 相对解析
      await writeFile(
        path.join(dir, 'tsconfig.json'),
        `{
          // 注释不应破坏解析
          "compilerOptions": {
            "baseUrl": ".",
            "paths": {
              "@lib/*": ["src/lib/*"],
              "@app/core/*": ["src/app/core/*"],
            }
          }
        }`
      )
      const m = await resolveTsPaths(dir)
      expect(m).not.toBeNull()
      // 根 tsconfig 的 dir = ""；best-match：固定前缀长者优先
      expect(m!.map((x) => x.pattern)).toEqual(['@app/core/*', '@lib/*'])
      expect(m![0].dir).toBe('')
      expect(m![1].targets).toEqual(['src/lib/*'])

      // 无 tsconfig / 无 paths → null（fail-open）
      const empty = await mkdtemp(
        path.join(tmpdir(), 'lintsight-tspaths-empty-')
      )
      try {
        expect(await resolveTsPaths(empty)).toBeNull()
        await writeFile(
          path.join(empty, 'tsconfig.json'),
          '{ "compilerOptions": {} }'
        )
        expect(await resolveTsPaths(empty)).toBeNull()
        // 坏 JSONC → null 不抛
        await writeFile(path.join(empty, 'tsconfig.json'), '{ broken')
        expect(await resolveTsPaths(empty)).toBeNull()
      } finally {
        await rm(empty, { recursive: true, force: true })
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('FR-304① 嵌套 tsconfig：per-package paths 各归各 + node_modules 跳过', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lintsight-tspaths-nested-'))
    try {
      await mkdir(path.join(dir, 'packages/a'), { recursive: true })
      await mkdir(path.join(dir, 'packages/b'), { recursive: true })
      await mkdir(path.join(dir, 'packages/a/node_modules/x'), {
        recursive: true
      })
      await writeFile(
        path.join(dir, 'packages/a/tsconfig.json'),
        JSON.stringify({
          compilerOptions: { paths: { '@self/*': ['src/*'] } }
        })
      )
      await writeFile(
        path.join(dir, 'packages/b/tsconfig.json'),
        JSON.stringify({
          compilerOptions: { paths: { '@self/*': ['lib/*'] } }
        })
      )
      // node_modules 内 tsconfig 必须跳过
      await writeFile(
        path.join(dir, 'packages/a/node_modules/x/tsconfig.json'),
        JSON.stringify({
          compilerOptions: { paths: { '@self/*': ['evil/*'] } }
        })
      )
      // 发现范围 = cwd 根 tsconfig + 扫描根（'.' = dir 全树）
      const m = await resolveTsPaths(dir, ['.'])
      expect(m).not.toBeNull()
      expect(m).toHaveLength(2) // node_modules 内的 evil tsconfig 必须被跳过
      const a = m!.find((x) => x.dir === 'packages/a')
      const b = m!.find((x) => x.dir === 'packages/b')
      expect(a?.targets).toEqual(['packages/a/src/*'])
      expect(b?.targets).toEqual(['packages/b/lib/*'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('FR-304 别名兜底端到端：tsconfig paths 别名 import 命中 zone 边界', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lintsight-arch-alias-'))
    try {
      await cp(path.join(PROJECT_ROOT, 'plugins'), path.join(dir, 'plugins'), {
        recursive: true
      })
      await mkdir(path.join(dir, 'src/app'), { recursive: true })
      await mkdir(path.join(dir, 'src/lib'), { recursive: true })
      await writeFile(
        path.join(dir, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            baseUrl: '.',
            paths: { '@lib/*': ['src/lib/*'] }
          }
        })
      )
      await writeFile(
        path.join(dir, 'lintsight.config.json'),
        JSON.stringify({
          rules: {},
          arch: {
            zones: [
              { name: 'app', match: ['src/app/**'], allow: [] },
              { name: 'lib', match: ['src/lib/**'], allow: ['src/app/**'] }
            ]
          }
        })
      )
      await writeFile(path.join(dir, 'src/lib/util.ts'), 'export const u = 1\n')
      await writeFile(
        path.join(dir, 'src/app/a.ts'),
        "import { u } from '@lib/util'\nconsole.log(u)\n"
      )
      const r = await runPipeline(['.'], { cwd: dir })
      const hits =
        r.report?.diagnostics.filter(
          (d) => d.ruleId === 'lintsight-engine/arch-boundaries'
        ) ?? []
      expect(hits).toHaveLength(1)
      expect(hits[0].message).toContain('src/lib/util')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('zone 越界 import → lintsight-engine/arch-boundaries 进统一报告', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lintsight-arch-'))
    try {
      // lintsight.config.json 形态要求插件产物可解析（业务项目布局）
      await cp(path.join(PROJECT_ROOT, 'plugins'), path.join(dir, 'plugins'), {
        recursive: true
      })
      await mkdir(path.join(dir, 'src/core'), { recursive: true })
      await mkdir(path.join(dir, 'src/ui'), { recursive: true })
      await writeFile(
        path.join(dir, 'lintsight.config.json'),
        JSON.stringify({
          rules: {},
          arch: {
            zones: [
              { name: 'core', match: ['src/core/**'], allow: [] },
              { name: 'ui', match: ['src/ui/**'], allow: ['src/core/**'] }
            ]
          }
        })
      )
      await writeFile(path.join(dir, 'src/ui/b.ts'), 'export const b = 2\n')
      // core allow 为空 → 跨 zone 引用越界
      await writeFile(
        path.join(dir, 'src/core/a.ts'),
        "import { b } from '../ui/b'\nconsole.log(b)\n"
      )
      // ui → core：allow 放行
      await writeFile(
        path.join(dir, 'src/ui/c.ts'),
        "import { b } from '../core/a'\nconsole.log(b)\n"
      )
      const r = await runPipeline(['.'], { cwd: dir })
      const hits =
        r.report?.diagnostics.filter(
          (d) => d.ruleId === 'lintsight-engine/arch-boundaries'
        ) ?? []
      expect(hits).toHaveLength(1)
      expect(hits[0].file).toBe('src/core/a.ts')
      expect(hits[0].span.line).toBe(1)
      expect(hits[0].owner).toBe('lintsight-engine')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('engine-bridge: FR-304②③ opt-in 引擎能力（importCycles / enforceExports）', () => {
  test('importCycles: a↔b 循环 → 每文件 1 条；菱形依赖不报；开关关闭零报告', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lintsight-cycles-'))
    try {
      await cp(path.join(PROJECT_ROOT, 'plugins'), path.join(dir, 'plugins'), {
        recursive: true
      })
      await mkdir(path.join(dir, 'src'), { recursive: true })
      await writeFile(
        path.join(dir, 'lintsight.config.json'),
        JSON.stringify({
          rules: {},
          arch: { zones: [], importCycles: true }
        })
      )
      await writeFile(
        path.join(dir, 'src/a.ts'),
        "import { b } from './b'\nexport const a = 1\n"
      )
      await writeFile(
        path.join(dir, 'src/b.ts'),
        "import { a } from './a'\nexport const b = 2\n"
      )
      // 菱形（非环）：main → x / main → y / x → z / y → z
      await writeFile(
        path.join(dir, 'src/main.ts'),
        "import './x'\nimport './y'\n"
      )
      await writeFile(path.join(dir, 'src/x.ts'), "import './z'\n")
      await writeFile(path.join(dir, 'src/y.ts'), "import './z'\n")
      await writeFile(path.join(dir, 'src/z.ts'), 'export const z = 3\n')

      const r = await runPipeline(['.'], { cwd: dir })
      const hits =
        r.report?.diagnostics.filter(
          (d) => d.ruleId === 'lintsight-engine/no-import-cycle'
        ) ?? []
      expect(hits).toHaveLength(2)
      const files = hits.map((h) => h.file).sort()
      expect(files).toEqual(['src/a.ts', 'src/b.ts'])
      // message 携带确定性环链（真实路径口径）
      expect(hits[0].message).toContain('src/a.ts → src/b.ts → src/a.ts')

      // 开关关闭（默认）→ 零报告（opt-in 语义回归哨兵）
      await writeFile(
        path.join(dir, 'lintsight.config.json'),
        JSON.stringify({ rules: {}, arch: { zones: [] } })
      )
      const r2 = await runPipeline(['.'], { cwd: dir })
      expect(
        r2.report?.diagnostics.some(
          (d) => d.ruleId === 'lintsight-engine/no-import-cycle'
        )
      ).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('enforceExports: 深导入未在 exports 键集 → 报；根导入/键集命中/无 exports 包不报', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lintsight-exports-'))
    try {
      await cp(path.join(PROJECT_ROOT, 'plugins'), path.join(dir, 'plugins'), {
        recursive: true
      })
      await mkdir(path.join(dir, 'packages/api/src'), { recursive: true })
      await mkdir(path.join(dir, 'legacy'), { recursive: true })
      await writeFile(
        path.join(dir, 'lintsight.config.json'),
        JSON.stringify({
          rules: {},
          arch: { zones: [], enforceExports: true }
        })
      )
      await writeFile(
        path.join(dir, 'packages/api/package.json'),
        JSON.stringify({
          name: '@corp/api',
          exports: { '.': './src/index.ts', './public/*': './src/*.ts' }
        })
      )
      await writeFile(
        path.join(dir, 'legacy/package.json'),
        JSON.stringify({ name: 'legacy-pkg' }) // 无 exports → 不约束
      )
      await writeFile(path.join(dir, 'packages/api/src/index.ts'), 'export {}')
      await writeFile(path.join(dir, 'packages/api/src/util.ts'), 'export {}')
      await writeFile(
        path.join(dir, 'app.ts'),
        [
          "import { x } from '@corp/api/src/internal'", // 深导入 → 报
          "import { y } from '@corp/api/public/util'", // 键集 ./public/* 命中 → 不报
          "import api from '@corp/api'", // 根导入（键 .）→ 不报
          "import l from 'legacy-pkg/anything'", // 无 exports 包 → 不报
          "import './local'", // 相对导入 → 不报
          ''
        ].join('\n')
      )

      const r = await runPipeline(['.'], { cwd: dir })
      const hits =
        r.report?.diagnostics.filter(
          (d) => d.ruleId === 'lintsight-engine/no-deep-import'
        ) ?? []
      expect(hits).toHaveLength(1)
      expect(hits[0].file).toBe('app.ts')
      expect(hits[0].span.line).toBe(1)
      expect(hits[0].message).toContain("'@corp/api/src/internal'")
      expect(hits[0].message).toContain('@corp/api')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
