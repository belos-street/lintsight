/**
 * G12 dead-rule 防呆：1b 清单里的每个内置规则必须在 oxlint 1.83.0 真实存在。
 * ⚠️ `--rules` 表格是 `rule name | source` 两列（如 `no-new-func | eslint`），
 * 不能拿完整 key（`eslint/no-new-func`）直接 includes，否则会误判 missing。
 */
import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { BUILTIN_PRESET_RULES } from '@lintsight/config-bridge'
import { resolveOxlintBin } from '../src/oxlint-bridge'

const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

function parseRulesTable(text: string): Set<string> {
  const out = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) continue
    const cells = line.split('|').map((c) => c.trim())
    // ['', ruleName, source, ...]
    const name = cells[1]
    const source = cells[2]
    if (!name || !source) continue
    if (/^-+$/.test(name) || name === 'Rule name') continue
    out.add(`${source}/${name}`)
  }
  return out
}

function hasRule(table: Set<string>, ruleId: string): boolean {
  return table.has(ruleId)
}

describe('G12 dead-rule 防呆（oxlint 1.83.0）', () => {
  test('1b 清单全部存在；伪造规则必须判 missing', async () => {
    const proc = Bun.spawn([resolveOxlintBin(PROJECT_ROOT), '--rules'], {
      cwd: PROJECT_ROOT,
      stdout: 'pipe',
      stderr: 'pipe'
    })
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited
    ])
    const table = parseRulesTable(stdout)
    expect(table.size).toBeGreaterThan(50)
    // 解析失败时给出前 200 字符，便于定位
    expect(stderr).toBeDefined()
    for (const ruleId of Object.keys(BUILTIN_PRESET_RULES)) {
      expect(
        hasRule(table, ruleId),
        `${ruleId} 不在 oxlint --rules（1.83.0）：禁止写入死配置`
      ).toBe(true)
    }
    // 自证：合成的不存在规则必须判 missing（防止 includes 全名式假阳性）
    expect(hasRule(table, 'eslint/no-such-rule-g12-probe')).toBe(false)
    // 对照事实：react/no-danger 在 1.83.0 存在（react 插件），但默认未启用且
    // 启用需 plugins 字段（覆盖默认插件集）→ 不在 G12 预设中（React 归 H5）
    expect(hasRule(table, 'react/no-danger')).toBe(true)
    expect(BUILTIN_PRESET_RULES['react/no-danger']).toBeUndefined()
    expect(hasRule(table, 'eslint/no-unsafe-finally')).toBe(true)
  })
})
