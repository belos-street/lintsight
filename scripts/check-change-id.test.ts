import { describe, expect, test } from 'bun:test'
import { needsChangeId, resolveRange } from './check-change-id'

const msg = (id?: string) =>
  `feat(cli): 示例变更${id ? `\n\nchange/${id}` : ''}`

describe('check-change-id（G3 range 共用纯函数）', () => {
  test('3+ 代码文件且无 change-id → 拦截', () => {
    const r = needsChangeId(msg(), [
      'packages/a.ts',
      'packages/b.ts',
      'crates/engine/src/main.rs'
    ])
    expect(r.required).toBe(true)
    expect(r.effective).toHaveLength(3)
  })

  test('含 change-id / 少量代码 / merge/revert → 放行', () => {
    expect(
      needsChangeId(msg('20261030-demo'), [
        'packages/a.ts',
        'packages/b.ts',
        'packages/c.ts'
      ]).required
    ).toBe(false)
    expect(
      needsChangeId(msg(), ['packages/a.ts', 'docs/readme.md']).required
    ).toBe(false)
    expect(needsChangeId('Merge branch main', ['a.ts', 'b.ts', 'c.ts']).required).toBe(
      false
    )
    expect(needsChangeId('Revert "x"', ['a.ts', 'b.ts', 'c.ts']).required).toBe(
      false
    )
  })

  test('排除测试/文档/生成产物后不足 3 个 → 放行', () => {
    expect(
      needsChangeId(msg(), [
        'packages/a.ts',
        'packages/a.test.ts',
        'docs/design.md',
        'plugins/lintsight-rules/index.js'
      ]).required
    ).toBe(false)
  })
})

describe('check-change-id（G3 --since 历史截止点）', () => {
  test('无截止点 → 保持 CI 原始范围', () => {
    expect(resolveRange('origin/main...HEAD')).toBe('origin/main...HEAD')
    expect(resolveRange('309291c..HEAD')).toBe('309291c..HEAD')
  })

  test('有截止点 → 只校验 cutoff..head（历史提交豁免）', () => {
    expect(resolveRange('origin/main...HEAD', 'd98c457')).toBe('d98c457..HEAD')
    expect(resolveRange('309291c..HEAD', 'd98c457')).toBe('d98c457..HEAD')
  })

  test('非法范围 / 缺 head → null（调用方 exit 2）', () => {
    expect(resolveRange('HEAD')).toBeNull()
    expect(resolveRange('origin/main...')).toBeNull()
  })
})
