import { describe, expect, test } from 'bun:test'
import {
  collectVersions,
  parseCargoPackageVersion,
  versionMismatches
} from './version-check'

describe('version:check（G14）', () => {
  test('当前三载体版本一致', () => {
    const v = collectVersions()
    expect(v.root).toBe(v.cli)
    expect(v.root).toBe(v.engine)
    expect(versionMismatches(v)).toEqual([])
  })

  test('Cargo 只解析 [package] 段，不误读依赖版本', () => {
    const cargo = [
      '[package]',
      'name = "demo"',
      'version = "1.2.3"',
      '',
      '[dependencies]',
      'serde = "9.9.9"'
    ].join('\n')
    expect(parseCargoPackageVersion(cargo)).toBe('1.2.3')
    expect(parseCargoPackageVersion('[dependencies]\nserde = "9.9.9"')).toBeNull()
  })

  test('任一载体漂移 → 报错', () => {
    expect(
      versionMismatches({ root: '1.0.0', cli: '0.1.0', engine: '1.0.0' }).length
    ).toBeGreaterThan(0)
  })
})
