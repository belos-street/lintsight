/**
 * SV6 → T1.1 迁移：竖切闭环验收（design-m1 §1 / requirements §11.3）。
 * CLI 输入 → config-bridge → oxlint(JS Plugin + .vue 虚拟块) → 带指纹 JSON → exit code。
 */
import { describe, expect, test } from 'bun:test'
import { runPipeline } from '../src/pipeline'

const PROJECT_ROOT = new URL('../../../', import.meta.url).pathname

describe('竖切闭环（§11.3）', () => {
  test('目录扫描：exit=1，TS 与 .vue 诊断齐全，JSON 重跑一致（指纹稳定）', async () => {
    const r1 = await runPipeline(['fixtures'], { cwd: PROJECT_ROOT })
    const r2 = await runPipeline(['fixtures'], { cwd: PROJECT_ROOT })

    expect(r1.exitCode).toBe(1)
    expect(r1.report).not.toBeNull()

    // 报告整体重跑一致 → 指纹与顺序均稳定（M1-DR4）
    expect(JSON.stringify(r2.report)).toBe(JSON.stringify(r1.report))

    // contractVersion 契约
    expect(r1.report!.contractVersion).toBe('1')

    const own = r1.report!.diagnostics.filter((d) => d.ruleId === 'lintsight/no-empty-catch')
    expect(own).toHaveLength(5) // bad-1 / bad-2 / bad-3(×2) / .vue(×1)

    // TS 轨道
    expect(own.some((d) => d.file === 'fixtures/ts/no-empty-catch.bad-1.ts' && d.span.line === 5)).toBeTrue()

    // Vue 竖切：诊断已映射回原 .vue 路径
    const vueDiag = own.find((d) => d.file === 'fixtures/vue/no-empty-catch.vue')
    expect(vueDiag).toBeDefined()
    expect(vueDiag!.span.line).toBe(13)
    expect(vueDiag!.span.column).toBe(5)

    // 指纹形态与跨运行稳定性（按 ruleId 过滤：同一 .vue 还有内置规则噪音诊断）
    expect(vueDiag!.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(
      r2.report!.diagnostics.find(
        (d) => d.ruleId === 'lintsight/no-empty-catch' && d.file === 'fixtures/vue/no-empty-catch.vue'
      )!.fingerprint
    ).toBe(vueDiag!.fingerprint)

    // owner 字段（注册表联动，§4.6）
    expect(vueDiag!.owner).toBe('lintsight-js')
    expect(r1.report!.diagnostics.some((d) => d.ruleId === 'eslint/no-unused-vars' && d.owner === 'oxlint-native')).toBeTrue()
  })

  test('exit=0：无 error 级诊断（warning 不拦截 CI）', async () => {
    const r = await runPipeline(['fixtures/ts/no-empty-catch.good-1.ts'], { cwd: PROJECT_ROOT })
    expect(r.exitCode).toBe(0)
  })

  test('exit=2：输入路径不存在 → 运行错误（与诊断退出码严格区分）', async () => {
    const r = await runPipeline(['no/such/path.ts'], { cwd: PROJECT_ROOT })
    expect(r.exitCode).toBe(2)
    expect(r.report).toBeNull()
  })
})
