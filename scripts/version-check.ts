/**
 * G14 单一版本源校验：根 package.json / CLI package.json / 引擎 Cargo.toml。
 * check-only（不修改文件）；CI static 阶段执行。
 * 用法：bun run version:check
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))

export interface VersionTriple {
  root: string
  cli: string
  engine: string
}

/** 只解析 Cargo.toml 的 [package] 段（避免误把依赖版本当包版本；workspace 化后需换 cargo metadata） */
export function parseCargoPackageVersion(text: string): string | null {
  let inPackage = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('[')) {
      inPackage = line === '[package]'
      continue
    }
    if (!inPackage) continue
    const m = line.match(/^version\s*=\s*"([^"]+)"/)
    if (m) return m[1]
  }
  return null
}

export function collectVersions(root = ROOT): VersionTriple {
  const rootPkg = JSON.parse(
    readFileSync(path.join(root, 'package.json'), 'utf8')
  ) as { version?: string }
  const cliPkg = JSON.parse(
    readFileSync(
      path.join(root, 'packages', 'lintsight-cli', 'package.json'),
      'utf8'
    )
  ) as { version?: string }
  const cargo = readFileSync(
    path.join(root, 'crates', 'lintsight-engine', 'Cargo.toml'),
    'utf8'
  )
  return {
    root: rootPkg.version ?? '(missing)',
    cli: cliPkg.version ?? '(missing)',
    engine: parseCargoPackageVersion(cargo) ?? '(missing)'
  }
}

export function versionMismatches(v: VersionTriple): string[] {
  if (v.root === v.cli && v.root === v.engine) return []
  return [
    `版本漂移：root=${v.root} cli=${v.cli} engine=${v.engine}`,
    '修复：bump 根 package.json，同步 packages/lintsight-cli/package.json 与 crates/lintsight-engine/Cargo.toml，再跑 bun run version:check'
  ]
}

function main(): never {
  const versions = collectVersions()
  const mismatches = versionMismatches(versions)
  if (mismatches.length === 0) {
    console.log(
      `version:check ✓ root=cli=engine=${versions.root}`
    )
    process.exit(0)
  }
  for (const line of mismatches) console.error(line)
  process.exit(1)
}

if (import.meta.main) main()
