/**
 * G14 单一版本源：根 / CLI / SARIF / --version 同源。
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatSarif } from '@lintsight/formatter'
import {
  collectVersions,
  parseCargoPackageVersion
} from '../../../scripts/version-check'

const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url))

async function spawnCli(args: string[]) {
  const proc = Bun.spawn([process.execPath, CLI, ...args], {
    cwd: PROJECT_ROOT,
    stdout: 'pipe',
    stderr: 'pipe'
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited
  ])
  return { stdout, stderr, code }
}

describe('G14 单一版本源', () => {
  test('根 / CLI / Cargo 三载体一致', () => {
    const v = collectVersions(PROJECT_ROOT)
    expect(v.root).toBe(v.cli)
    expect(v.root).toBe(v.engine)
  })

  test('SARIF driver.version/semanticVersion 使用同源版本', () => {
    const { root } = collectVersions(PROJECT_ROOT)
    const sarif = JSON.parse(
      formatSarif(
        {
          contractVersion: '3',
          engineStatus: 'ok',
          files: 1,
          summary: { error: 0, warning: 0, info: 0, suppressed: 0 },
          diagnostics: []
        },
        { toolVersion: root }
      )
    )
    expect(sarif.runs[0].tool.driver.version).toBe(root)
    expect(sarif.runs[0].tool.driver.semanticVersion).toBe(root)
  })

  test('--version 输出根版本', async () => {
    const { root } = collectVersions(PROJECT_ROOT)
    const r = await spawnCli(['--version'])
    expect(r.code).toBe(0)
    expect(r.stdout.trim()).toBe(`lintsight v${root}`)
  })

  test('Cargo parser 不误读依赖段（与 version:check 同源）', () => {
    const cargo = readFileSync(
      path.join(PROJECT_ROOT, 'crates/lintsight-engine/Cargo.toml'),
      'utf8'
    )
    expect(parseCargoPackageVersion(cargo)).toBe(
      collectVersions(PROJECT_ROOT).root
    )
  })
})
