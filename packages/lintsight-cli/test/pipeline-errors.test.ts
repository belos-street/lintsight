/**
 * T1.3 exit 2 契约单测：运行错误路径禁止异常逃逸（M1-DR3）。
 * 临时文件放系统 tmpdir——.lintsight-cache 会被 pipeline 启动时清空，不能用。
 */
import { afterAll, describe, expect, test } from 'bun:test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { runPipeline } from '../src/pipeline'

const PROJECT_ROOT = new URL('../../../', import.meta.url).pathname
const TMP = `${tmpdir()}/lintsight-pipeline-errors-test`

afterAll(async () => {
  await rm(TMP, { recursive: true, force: true })
})

describe('exit code 2 契约（运行错误）', () => {
  test('输入路径不存在', async () => {
    const r = await runPipeline(['definitely/not/here.ts'], {
      cwd: PROJECT_ROOT
    })
    expect(r.exitCode).toBe(2)
    expect(r.report).toBeNull()
    expect(r.error).toContain('input path not found')
  })

  test('目录存在但无可扫文件（docs 只有 .md）', async () => {
    const r = await runPipeline(['docs'], { cwd: PROJECT_ROOT })
    expect(r.exitCode).toBe(2)
    expect(r.error).toBe('no scannable files found')
  })

  test('输入是不支持类型的文件（.md）', async () => {
    await mkdir(TMP, { recursive: true })
    await writeFile(`${TMP}/note.md`, '# note')
    const r = await runPipeline([`${TMP}/note.md`], { cwd: PROJECT_ROOT })
    expect(r.exitCode).toBe(2)
    expect(r.report).toBeNull()
  })

  test('OXLINT_BIN 指向不存在的可执行文件 → spawn 失败被捕获', async () => {
    await mkdir(TMP, { recursive: true })
    await writeFile(`${TMP}/clean.ts`, 'export const a = 1\n')
    const saved = process.env.OXLINT_BIN
    process.env.OXLINT_BIN = `${TMP}/missing-oxlint`
    try {
      const r = await runPipeline([`${TMP}/clean.ts`], { cwd: PROJECT_ROOT })
      expect(r.exitCode).toBe(2)
      expect(r.report).toBeNull()
      expect(r.error).toBeDefined()
    } finally {
      if (saved === undefined) delete process.env.OXLINT_BIN
      else process.env.OXLINT_BIN = saved
    }
  })

  test('配置无效 → exit 2 且错误信息含字段路径', async () => {
    await mkdir(TMP, { recursive: true })
    await writeFile(
      `${TMP}/bad.config.json`,
      '{ "rules": { "lintsight/x": "fatal" } }'
    )
    const r = await runPipeline(['docs'], {
      cwd: PROJECT_ROOT,
      config: `${TMP}/bad.config.json`
    })
    expect(r.exitCode).toBe(2)
    expect(r.error).toContain('rules["lintsight/x"]')
  })
})
