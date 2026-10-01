/**
 * Vue SFC 虚拟块单元断言（spike ② / M1-DR5 / S5 T1.14+T1.15）。
 * 端到端位置回映射断言在 @lintsight/cli 的 closed-loop 测试（避免包间循环依赖）。
 */
import { describe, expect, test } from 'bun:test'
import {
  buildVirtualContent,
  ensureGitignore,
  isInPlaceVirtualPath,
  selectScriptBlock,
  virtualizeVue,
  writebackFix
} from '../src/index'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const SOURCE = `<template>
  <button @click="load">load</button>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const status = ref('idle')

async function load(): Promise<void> {
  try {
    status.value = 'loading'
  } catch {
  }
}
</script>

<style scoped>
button { color: blue; }
</style>
`

describe('vue-processor: SFC 虚拟块', () => {
  test('selectScriptBlock：lang/起始行正确，template/style 不进入虚拟文件', () => {
    const { block, warnings } = selectScriptBlock(SOURCE)
    expect(block).not.toBeNull()
    expect(warnings).toHaveLength(0)
    expect(block!.lang).toBe('ts')
    expect(block!.startLine).toBe(6) // <script> 在第 5 行，内容从第 6 行开始
    expect(block!.content).toContain("import { ref } from 'vue'")
    expect(block!.content).not.toContain('<template>')
  })

  test('buildVirtualContent：行号 1:1 对齐（空 catch 落在第 13 行）', () => {
    const { block } = selectScriptBlock(SOURCE)
    const virtual = buildVirtualContent(SOURCE, block!)
    const lines = virtual.split('\n')
    expect(lines[12]).toContain('catch') // 第 13 行
    expect(lines[13].trim()).toBe('}') // 第 14 行
    expect(lines[0]).toBe('') // 非 script 行置空
  })

  test('多块策略：优先 <script setup>，其余块显式告警（不静默漏扫）', () => {
    const multi = `<script>
const a = 1
</script>
<script setup lang="ts">
const b = 2
</script>
`
    const { block, warnings } = selectScriptBlock(multi)
    expect(block!.lang).toBe('ts')
    expect(block!.content).toContain('const b = 2')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('未被选中')
  })

  test('多块策略：无 setup 时取首个 script', () => {
    const two = `<script>
const a = 1
</script>
<script>
const b = 2
</script>
`
    const { block, warnings } = selectScriptBlock(two)
    expect(block!.content).toContain('const a = 1')
    expect(warnings).toHaveLength(1)
  })

  test('边界：同行开标签 / src 外链 → 显式告警；无 script → null 无告警', () => {
    const sameLine = selectScriptBlock('<script>let a = 1</script>')
    expect(sameLine.block).toBeNull()
    expect(sameLine.warnings).toHaveLength(1)
    expect(sameLine.warnings[0]).toContain('同行')

    const external = selectScriptBlock('<script src="./a.js"></script>')
    expect(external.block).toBeNull()
    expect(external.warnings[0]).toContain('外链')

    const none = selectScriptBlock('<template><div/></template>')
    expect(none.block).toBeNull()
    expect(none.warnings).toHaveLength(0)
  })

  test('isInPlaceVirtualPath：就地临时文件名匹配（pid+序号后缀）', () => {
    expect(isInPlaceVirtualPath('src/App.vue.lintsight-123-0.ts')).toBe(true)
    expect(isInPlaceVirtualPath('src/App.vue.lintsight-123-0.js')).toBe(true)
    expect(isInPlaceVirtualPath('src/App.vue.ts')).toBe(false) // 用户自己的文件
    expect(isInPlaceVirtualPath('src/App.ts')).toBe(false)
  })
})

describe('vue-processor: 就地临时文件 + fix 回写（T1.14/T1.15）', () => {
  test('virtualizeVue：就地写入同目录，路径回映射信息齐全', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lintsight-vue-'))
    try {
      const vueAbs = path.join(dir, 'Comp.vue')
      await writeFile(vueAbs, SOURCE)
      const v = await virtualizeVue(vueAbs, dir)
      expect(v).not.toBeNull()
      expect(v!.originalRel).toBe('Comp.vue')
      // pid+序号后缀：就地命名但与用户文件可区分
      expect(path.basename(v!.virtualAbs)).toMatch(
        /^Comp\.vue\.lintsight-\d+-\d+\.ts$/
      )
      expect(v!.virtualRel).toBe(path.basename(v!.virtualAbs))
      expect(v!.warnings).toHaveLength(0)
      // 就地 = 与原文件同目录（import 解析上下文一致）
      expect(path.dirname(v!.virtualAbs)).toBe(dir)
      const virtualContent = await readFile(v!.virtualAbs, 'utf8')
      expect(virtualContent.split('\n').length).toBe(SOURCE.split('\n').length)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('writebackFix：行数不变的 fix 逐行回写；行数变化显式跳过', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lintsight-vue-'))
    try {
      const vueAbs = path.join(dir, 'Comp.vue')
      await writeFile(vueAbs, SOURCE)
      const v = (await virtualizeVue(vueAbs, dir))!

      // 模拟 oxlint --fix 改写第 3 行（行数不变）
      const lines = (await readFile(v.virtualAbs, 'utf8')).split('\n')
      lines[2] = '  <button @click="reload">load</button>'
      await writeFile(v.virtualAbs, lines.join('\n'))

      const wb = await writebackFix(vueAbs, v.virtualAbs)
      expect(wb).toEqual({ changed: true, lines: 1, skipped: false })
      const fixed = (await readFile(vueAbs, 'utf8')).split('\n')
      expect(fixed[2]).toContain('reload')
      expect(fixed[15]).toContain('</script>') // 其余行原样

      // 行数变化 → 显式跳过
      const grown = lines.slice()
      grown.splice(20, 0, '  // inserted by fix')
      await writeFile(v.virtualAbs, grown.join('\n'))
      const wb2 = await writebackFix(vueAbs, v.virtualAbs)
      expect(wb2).toEqual({ changed: false, lines: 0, skipped: true })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('ensureGitignore：幂等追加规则；无 .gitignore 不创建', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'lintsight-vue-'))
    try {
      // 无 .gitignore → 不创建
      expect(await ensureGitignore(dir)).toBe(false)
      expect(await Bun.file(`${dir}/.gitignore`).exists()).toBe(false)

      // 已有 .gitignore → 追加；重复调用幂等
      await writeFile(`${dir}/.gitignore`, 'node_modules\n')
      expect(await ensureGitignore(dir)).toBe(true)
      const first = await readFile(`${dir}/.gitignore`, 'utf8')
      expect(first).toContain('*.lintsight-*.ts')
      expect(await ensureGitignore(dir)).toBe(false)
      const second = await readFile(`${dir}/.gitignore`, 'utf8')
      expect(second).toBe(first)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
