/**
 * T1.4 JSON 报告 golden file：schema 或规则面变化 → diff → 显式 review（design-m1 §4.4/§7）。
 * 用手工 golden file（CI 环境下 bun 内置 snapshot 禁用；golden file 可提交、可 review）。
 * 重新生成：删除 __golden__/report-v2.json 后重跑 bun test。
 */
import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runPipeline } from '../src/pipeline'
import { formatJson } from '@lintsight/formatter'

const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const GOLDEN = fileURLToPath(
  new URL('./__golden__/report-v2.json', import.meta.url)
)

describe('JSON 报告 golden（contractVersion=2）', () => {
  test('fixtures 全量扫描报告', async () => {
    // ⚠️ 显式列出子目录：fixtures/options/ 是选项组用例（不进全量扫描面，见 closed-loop 注释）
    const r = await runPipeline(['fixtures/ts', 'fixtures/vue'], {
      cwd: PROJECT_ROOT
    })
    expect(r.report).not.toBeNull()
    // golden 统一以换行结尾（文件惯例），比对时对齐
    const actual = `${formatJson(r.report!)}\n`
    if (!existsSync(GOLDEN)) {
      await Bun.write(GOLDEN, actual)
      console.log(`golden 首次生成：${GOLDEN}`)
      return
    }
    const golden = await Bun.file(GOLDEN).text()
    expect(actual).toBe(golden)
  })
})
