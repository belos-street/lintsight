import { describe, expect, test } from 'bun:test'
import { needsChangeId } from './check-change-id'

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
