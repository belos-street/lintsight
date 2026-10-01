/**
 * 内容哈希缓存（T1.16 / requirements §3.4 / §11.2）：
 * 键 = sha256(引擎指纹 | 规则配置指纹 | 规则集指纹 | 文件内容哈希)。
 * M1 收窄：依赖闭包哈希 / tsconfig 哈希是 M2（跨文件规则）才需要的成分。
 *
 * 降级语义（fail-open）：
 *   - oxlint 二进制不可解析（未安装 / OXLINT_BIN 无效）→ 缓存整体禁用，绝不因缓存挡住扫描；
 *   - 缓存读/写任何 IO 异常 → 当作 miss / 静默跳过，扫描照常（debug 级日志）。
 *
 * 修复模式（--fix）不得读缓存：fix 会改写文件，缓存里只有"最终诊断"，
 * 含可修复项的文件若命中缓存会被跳过 fix（pipeline 侧强制）。
 */
import path from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import type { LintsightDiagnostic } from '@lintsight/diagnostic'
import { createLogger } from '@lintsight/shared'
import { resolveOxlintBin } from './oxlint-bridge'

const CACHE_SUBDIR = 'cache'
const ENTRY_VERSION = 1
const log = createLogger('debug')

export interface CacheContext {
  enabled: boolean
  /** 条目目录：<cwd>/.lintsight-cache/cache */
  dir: string
  /** 引擎指纹（lintsight 版本 + oxlint 版本） */
  engine: string
  /** 规则配置指纹：lintsight.config.json + .oxlintrc.json + 生成 oxlintrc 内容 */
  config: string
  /** 规则集指纹：oxlintrc jsPlugins 引用的插件产物内容 */
  plugin: string
}

export interface InitCacheOptions {
  cwd: string
  /** 生成的 .oxlintrc 绝对路径；undefined = 无显式配置（回落 oxlint 自动发现） */
  oxlintrcPath?: string
  lintsightVersion: string
}

async function sha256File(absPath: string): Promise<string | null> {
  try {
    const content = await readFile(absPath)
    const digest = new Bun.CryptoHasher('sha256').update(content).digest('hex')
    return digest
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      log.debug(`cache: sha256 read failed for ${absPath}: ${String(e)}`)
    }
    return null
  }
}

/** oxlint --version（一次 spawn）；失败返回 null（→ 缓存禁用） */
async function oxlintVersion(cwd: string): Promise<string | null> {
  let bin: string
  try {
    bin = resolveOxlintBin(cwd)
  } catch {
    return null
  }
  try {
    const proc = Bun.spawn([bin, '--version'], {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe'
    })
    const out = await new Response(proc.stdout).text()
    const code = await proc.exited
    if (code !== 0) return null
    return out.trim()
  } catch {
    return null
  }
}

async function jsPluginPaths(oxlintrcPath: string): Promise<string[]> {
  let raw: string
  try {
    raw = await readFile(oxlintrcPath, 'utf8')
  } catch {
    return []
  }
  let parsed: { jsPlugins?: unknown }
  try {
    parsed = JSON.parse(raw) as { jsPlugins?: unknown }
  } catch (e) {
    log.debug(`cache: oxlintrc parse failed: ${String(e)}`)
    return []
  }
  if (!Array.isArray(parsed.jsPlugins)) return []
  return parsed.jsPlugins.filter((e): e is string => typeof e === 'string')
}

/** 收集 oxlintrc 中 jsPlugins 引用的插件产物内容指纹（规则逻辑变更必须击穿缓存） */
async function pluginFingerprint(
  oxlintrcPaths: (string | undefined)[]
): Promise<string> {
  const existing = await Promise.all(
    oxlintrcPaths.map(async (p) => (p ? await jsPluginPaths(p) : []))
  )
  const files = [...new Set(existing.flat())]
  const hashes = await Promise.all(
    files.map(async (f) => `${f}:${(await sha256File(f)) ?? 'missing'}`)
  )
  return hashes.join('|')
}

export async function initCache(opts: InitCacheOptions): Promise<CacheContext> {
  const dir = path.join(opts.cwd, '.lintsight-cache', CACHE_SUBDIR)

  const version = await oxlintVersion(opts.cwd)
  if (version === null) {
    return { enabled: false, dir, engine: 'disabled', config: '', plugin: '' }
  }

  const configHashes = await Promise.all([
    sha256File(path.join(opts.cwd, 'lintsight.config.json')),
    sha256File(path.join(opts.cwd, '.oxlintrc.json')),
    opts.oxlintrcPath ? sha256File(opts.oxlintrcPath) : Promise.resolve(null)
  ])
  const config = configHashes.map((h) => h ?? '-').join('|')
  const plugin = await pluginFingerprint([
    opts.oxlintrcPath,
    path.join(opts.cwd, '.oxlintrc.json')
  ])

  return {
    enabled: true,
    dir,
    engine: `lintsight@${opts.lintsightVersion}|oxlint@${version}`,
    config,
    plugin
  }
}

export function createCacheKey(
  ctx: CacheContext,
  fileContentHash: string
): string {
  return new Bun.CryptoHasher('sha256')
    .update(`${ctx.engine}|${ctx.config}|${ctx.plugin}|${fileContentHash}`)
    .digest('hex')
}

export async function sha256Content(absPath: string): Promise<string | null> {
  return sha256File(absPath)
}

export async function readCacheEntry(
  ctx: CacheContext,
  key: string
): Promise<LintsightDiagnostic[] | null> {
  if (!ctx.enabled) return null
  try {
    const raw = await readFile(path.join(ctx.dir, `${key}.json`), 'utf8')
    const entry = JSON.parse(raw) as {
      v: number
      engine: string
      diagnostics: LintsightDiagnostic[]
    }
    // 双保险：键碰撞之外的引擎漂移防护（版本指纹写进键，这里再校验一次）
    if (entry.v !== ENTRY_VERSION || entry.engine !== ctx.engine) return null
    if (!Array.isArray(entry.diagnostics)) return null
    return entry.diagnostics
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      log.debug(`cache: entry read failed (treated as miss): ${String(e)}`)
    }
    return null
  }
}

export async function writeCacheEntry(
  ctx: CacheContext,
  key: string,
  diagnostics: LintsightDiagnostic[]
): Promise<void> {
  if (!ctx.enabled) return
  try {
    await mkdir(ctx.dir, { recursive: true })
    await writeFile(
      path.join(ctx.dir, `${key}.json`),
      JSON.stringify({ v: ENTRY_VERSION, engine: ctx.engine, diagnostics })
    )
  } catch (e) {
    // 缓存写失败不影响扫描结果（fail-open）
    log.debug(`cache: entry write failed (ignored): ${String(e)}`)
  }
}
