/**
 * Vue SFC 虚拟块单元断言（spike ② / M1-DR5）。
 * 端到端位置回映射断言在 @lintsight/cli 的 closed-loop 测试（避免包间循环依赖）。
 */
import { describe, expect, test } from 'bun:test'
import {
  buildVirtualContent,
  extractScriptBlock,
  inverseVirtualPath
} from '../src/index'

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
  test('extractScriptBlock：lang/起始行正确，template/style 不进入虚拟文件', () => {
    const block = extractScriptBlock(SOURCE)
    expect(block).not.toBeNull()
    expect(block!.lang).toBe('ts')
    expect(block!.startLine).toBe(6) // <script> 在第 5 行，内容从第 6 行开始
    expect(block!.content).toContain("import { ref } from 'vue'")
    expect(block!.content).not.toContain('<template>')
  })

  test('buildVirtualContent：行号 1:1 对齐（空 catch 落在第 13 行）', () => {
    const block = extractScriptBlock(SOURCE)!
    const virtual = buildVirtualContent(SOURCE, block)
    const lines = virtual.split('\n')
    expect(lines[12]).toContain('catch') // 第 13 行
    expect(lines[13].trim()).toBe('}') // 第 14 行
    expect(lines[0]).toBe('') // 非 script 行置空
  })

  test('边界：同行开标签 / src 外链 / 无 script → 显式返回 null（不静默漏扫）', () => {
    expect(extractScriptBlock('<script>let a = 1</script>')).toBeNull() // 同行开标签
    expect(extractScriptBlock('<script src="./a.js"></script>')).toBeNull() // 外链
    expect(extractScriptBlock('<template><div/></template>')).toBeNull() // 无 script
  })

  test('inverseVirtualPath：非虚拟路径返回 null', () => {
    const PREFIX = '.lintsight-cache/'
    expect(inverseVirtualPath('src/App.vue.ts', PREFIX)).toBeNull()
    expect(inverseVirtualPath('.lintsight-cache/src/App.vue.ts', PREFIX)).toBe(
      'src/App.vue'
    )
    expect(
      inverseVirtualPath('.lintsight-cache/src/util.ts', PREFIX)
    ).toBeNull()
  })
})
