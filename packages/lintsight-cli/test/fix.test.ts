/**
 * T1.15 fix 回写收敛断言：--fix 就地改写虚拟文件 → 差量行回写原 .vue → 复扫收敛。
 * 机制实测（oxlint 1.83.0）：JSON 无 fix 字段，唯一机制 = --fix 写盘；safe fix 行数不变。
 */
import { describe, expect, test } from 'bun:test'
import { runPipeline } from '../src/pipeline'
import { mkdtemp, rm, writeFile, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const VUE_WITH_VAR = `<template>
  <button>{{ count }}</button>
</template>

<script setup lang="ts">
var count = 1
console.log(count)
</script>
`

describe('S5 T1.15: safe fix 逆映射回写（.vue 收敛）', () => {
  test('--fix：var→let/const 回写原 .vue，复扫收敛，临时文件零残留', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lintsight-fix-'))
    try {
      const vueAbs = path.join(dir, 'Comp.vue')
      await writeFile(vueAbs, VUE_WITH_VAR)
      await writeFile(
        path.join(dir, '.oxlintrc.json'),
        JSON.stringify({ rules: { 'no-var': 'error' } })
      )

      // 第一轮：--fix 回写
      const r1 = await runPipeline(['Comp.vue'], {
        cwd: dir,
        logLevel: 'error',
        fix: true
      })
      expect(r1.exitCode).toBe(0)
      const fixed = await readFile(vueAbs, 'utf8')
      const scriptLine = fixed.split('\n')[5] // var count = 1 所在行（第 6 行）
      expect(scriptLine).not.toContain('var ')
      expect(scriptLine).toContain('count = 1')
      expect(fixed.split('\n').length).toBe(VUE_WITH_VAR.split('\n').length) // 行数不变（safe fix 前提）

      // 收敛断言：第二轮（无 fix）同文件 0 诊断
      const r2 = await runPipeline(['Comp.vue'], {
        cwd: dir,
        logLevel: 'error'
      })
      expect(r2.exitCode).toBe(0)
      expect(r2.report?.diagnostics ?? []).toHaveLength(0)

      // 临时文件零残留（finally 清理只删本次创建的）
      const leftovers = (await readdir(dir)).filter((f) =>
        f.includes('lintsight-')
      )
      expect(leftovers).toHaveLength(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
