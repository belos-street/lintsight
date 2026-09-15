/**
 * SV5：Vue SFC 虚拟块注入 + 位置回映射（spike ② 核心风险）。
 * 断言：.vue 内空 catch 的诊断行/列与原 .vue 中位置一致（1:1 行号对齐方案）。
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import {
  buildVirtualContent,
  extractScriptBlock,
  inverseVirtualPath,
  virtualizeVue,
} from '../src/vue-processor';
import { runOxlint } from '../src/oxlint-bridge';

const PROJECT_ROOT = new URL('../../../', import.meta.url).pathname;
const VUE_FIXTURE = `${PROJECT_ROOT}fixtures/vue/no-empty-catch.vue`;
const CACHE_DIR = `${PROJECT_ROOT}.lintsight-cache`;
const CACHE_PREFIX = '.lintsight-cache/';

afterAll(async () => {
  await rm(CACHE_DIR, { recursive: true, force: true });
});

describe('vue-processor: SFC 虚拟块', () => {
  test('extractScriptBlock：lang/起始行正确，template/style 不进入虚拟文件', async () => {
    const source = await Bun.file(VUE_FIXTURE).text();
    const block = extractScriptBlock(source);
    expect(block).not.toBeNull();
    expect(block!.lang).toBe('ts');
    expect(block!.startLine).toBe(6); // <script> 在第 5 行，内容从第 6 行开始
    expect(block!.content).toContain("import { ref } from 'vue'");
    expect(block!.content).not.toContain('<template>');
  });

  test('buildVirtualContent：行号 1:1 对齐（空 catch 落在第 13 行）', async () => {
    const source = await Bun.file(VUE_FIXTURE).text();
    const block = extractScriptBlock(source)!;
    const virtual = buildVirtualContent(source, block);
    const lines = virtual.split('\n');
    expect(lines[12]).toContain('catch'); // 第 13 行
    expect(lines[13].trim()).toBe('}'); // 第 14 行
  });

  test('端到端：虚拟文件喂 oxlint → 诊断映射回原 .vue 路径，位置一致', async () => {
    const virtualized = await virtualizeVue(VUE_FIXTURE, PROJECT_ROOT, CACHE_DIR);
    expect(virtualized).not.toBeNull();

    const scan = await runOxlint([virtualized!.virtualAbs], { cwd: PROJECT_ROOT });
    const mapped = scan.normalized
      .map((d) => {
        const original = inverseVirtualPath(d.file, CACHE_PREFIX);
        return original ? { ...d, file: original } : d;
      })
      .filter((d) => d.ruleId === 'lintsight/no-empty-catch');

    expect(mapped).toHaveLength(1);
    expect(mapped[0].file).toBe('fixtures/vue/no-empty-catch.vue');
    expect(mapped[0].span.line).toBe(13); // 原 .vue 中 catch 所在行
    expect(mapped[0].span.column).toBe(5);
    expect(mapped[0].severity).toBe('error');
  });

  test('inverseVirtualPath：非虚拟路径返回 null', () => {
    expect(inverseVirtualPath('src/App.vue.ts', CACHE_PREFIX)).toBeNull();
    expect(inverseVirtualPath('.lintsight-cache/src/App.vue.ts', CACHE_PREFIX)).toBe('src/App.vue');
    expect(inverseVirtualPath('.lintsight-cache/src/util.ts', CACHE_PREFIX)).toBeNull();
  });
});
