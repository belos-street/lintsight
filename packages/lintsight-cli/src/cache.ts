/**
 * 内容哈希缓存（T1.16 / requirements §3.4 / §11.2；G1 正确性修复）：
 * 键 = sha256(条目版本 | 引擎指纹 | 配置指纹（含 tsconfig） | 插件指纹 | 文件路径 | 文件内容哈希)。
 *
 * 正确性边界（change/20261030-cache-correctness）：
 *   - 条目只存 M1（oxlint）按文件诊断；引擎诊断一律不缓存——引擎每轮按当前
 *     文件集全量 pass，跨文件规则 / 文件集 / tsconfig 别名变化天然冷热等价；
 *   - 空数组是合法命中（干净文件也写条目）；
 *   - 写入临时文件 + rename 原子发布，并发读者不会读到半截 JSON。
 *
 * 降级语义（fail-open）：
 *   - oxlint 二进制不可解析（未安装 / OXLINT_BIN 无效）→ 缓存整体禁用，绝不因缓存挡住扫描；
 *   - 缓存读/写任何 IO 异常 → 当作 miss / 静默跳过，扫描照常（debug 级日志）。
 *
 * 修复模式（--fix）不得读缓存：fix 会改写文件，缓存里只有"最终诊断"，
 * 含可修复项的文件若命中缓存会被跳过 fix（pipeline 侧强制）。
 */
import path from 'node:path'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import {
  CONTRACT_VERSION,
  type LintsightDiagnostic
} from '@lintsight/diagnostic'
import { parseJsonc } from '@lintsight/config-bridge'
import { createLogger } from '@lintsight/shared'
import { resolveOxlintBin } from './oxlint-bridge'

const CACHE_SUBDIR = 'cache'
/** v2：条目只存 M1 诊断（G1）；v1 条目（引擎诊断混存）读取即 miss */
const ENTRY_VERSION = 2
const log = createLogger('debug')

export interface CacheContext {
  enabled: boolean
  /** 条目目录：<cwd>/.lintsight-cache/cache */
  dir: string
  /** 引擎指纹（lintsight 版本 + oxlint 版本 + 引擎二进制 + 诊断契约版本） */
  engine: string
  /** 规则配置指纹：lintsight.config.json + .oxlintrc.json + 生成 oxlintrc + tsconfig */
  config: string
  /** 规则集指纹：oxlintrc jsPlugins 引用的插件产物内容 */
  plugin: string
}

export interface InitCacheOptions {
  cwd: string
  /** 生成的 .oxlintrc 绝对路径；undefined = 无显式配置（回落 oxlint 自动发现） */
  oxlintrcPath?: string
  lintsightVersion: string
  /** M2 引擎二进制路径（design-m2 §4.3）；其内容哈希并入引擎指纹——引擎升级必须击穿缓存 */
  engineBin?: string | null
  /** 本轮发现的 tsconfig 绝对路径（G1）：内容哈希并入配置指纹——别名/type-aware 变化必须击穿 */
  tsconfigFiles?: string[]
}

async function sha256File(absPath: string): Promise<string | null> {
  try {
    const content = await readFile(absPath)
    return new Bun.CryptoHasher('sha256').update(content).digest('hex')
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
  // 手写 .oxlintrc.json 是 JSONC（带注释）——JSON.parse 会静默失败导致
  // 插件指纹成分缺失（type-aware 试点暴露），改用 config-bridge 的 JSONC 解析
  let parsed: { jsPlugins?: unknown }
  try {
    parsed = parseJsonc(raw) as { jsPlugins?: unknown }
  } catch (e) {
    log.debug(`cache: oxlintrc parse failed: ${String(e)}`)
    return []
  }
  if (!Array.isArray(parsed.jsPlugins)) return []
  // jsPlugins 语义相对「oxlintrc 所在目录」（与 oxlint 一致）；生成配置给绝对路径，
  // 手写配置常见相对路径——按进程 cwd 解析会静默算作 missing（G1 修复）。
  const dir = path.dirname(oxlintrcPath)
  return parsed.jsPlugins
    .filter((e): e is string => typeof e === 'string')
    .map((e) => (path.isAbsolute(e) ? e : path.resolve(dir, e)))
}

/** 收集 oxlintrc 中 jsPlugins 引用的插件产物内容指纹（规则逻辑变更必须击穿缓存） */
async function pluginFingerprint(
  oxlintrcPaths: (string | undefined)[]
): Promise<string> {
  const existing = await Promise.all(
    oxlintrcPaths.map(async (p) => (p ? await jsPluginPaths(p) : []))
  )
  const files = [...new Set(existing.flat())].sort()
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

  // 配置指纹成分：固定发现位 + 生成配置 + 全部发现的 tsconfig（G1）
  const configEntries: { label: string; abs: string }[] = [
    {
      label: 'lintsight.config.json',
      abs: path.join(opts.cwd, 'lintsight.config.json')
    },
    { label: '.oxlintrc.json', abs: path.join(opts.cwd, '.oxlintrc.json') }
  ]
  if (opts.oxlintrcPath) {
    configEntries.push({ label: 'oxlintrc', abs: opts.oxlintrcPath })
  }
  const tsconfigs = [...new Set(opts.tsconfigFiles ?? [])]
    .map((f) => path.resolve(f))
    .sort()
  for (const abs of tsconfigs) {
    const rel = path.relative(opts.cwd, abs).split(path.sep).join('/')
    configEntries.push({ label: `tsconfig@${rel}`, abs })
  }
  const config = (
    await Promise.all(
      configEntries.map(
        async (e) => `${e.label}:${(await sha256File(e.abs)) ?? '-'}`
      )
    )
  ).join('|')
  const plugin = await pluginFingerprint([
    opts.oxlintrcPath,
    path.join(opts.cwd, '.oxlintrc.json')
  ])

  // M2 引擎指纹：bin 内容哈希（缺失 = none；fail-open 下引擎诊断本来就为空）
  const engineBinFp = opts.engineBin
    ? ((await sha256File(opts.engineBin))?.slice(0, 16) ?? 'none')
    : 'none'

  return {
    enabled: true,
    dir,
    // contract 盐：诊断模型字段变更（如 v2 的 pathEvents）必须击穿旧缓存条目
    engine: `lintsight@${opts.lintsightVersion}|oxlint@${version}|engine@${engineBinFp}|contract@${CONTRACT_VERSION}`,
    config,
    plugin
  }
}

/** 缓存键：路径与内容并列（同内容不同路径不得共享条目——G1） */
export function createCacheKey(
  ctx: CacheContext,
  fileRelPath: string,
  fileContentHash: string
): string {
  return new Bun.CryptoHasher('sha256')
    .update(
      `entry@${ENTRY_VERSION}|${ctx.engine}|${ctx.config}|${ctx.plugin}|path@${fileRelPath}|content@${fileContentHash}`
    )
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

/** 进程内临时文件序号（并发写同 key 时 tmp 名不互撞） */
let tmpSeq = 0

/** 同目录 rename 原子发布：并发读者只会看到旧/新完整文件。
 * Windows 偶发共享冲突（读者短暂持有目标文件）→ 短重试后放弃（fail-open）。
 * 用递归而不是循环，避免 no-await-in-loop 噪音（重试本身就是顺序语义）。 */
async function publishEntry(
  tmp: string,
  target: string,
  attempts = 3
): Promise<boolean> {
  try {
    await rename(tmp, target)
    return true
  } catch (e) {
    if (attempts <= 1) {
      log.debug(`cache: entry rename failed (ignored): ${String(e)}`)
      return false
    }
    await new Promise((r) => setTimeout(r, 5))
    return publishEntry(tmp, target, attempts - 1)
  }
}

export async function writeCacheEntry(
  ctx: CacheContext,
  key: string,
  diagnostics: LintsightDiagnostic[]
): Promise<void> {
  if (!ctx.enabled) return
  const target = path.join(ctx.dir, `${key}.json`)
  const tmp = `${target}.${process.pid}.${tmpSeq++}.tmp`
  try {
    await mkdir(ctx.dir, { recursive: true })
    await writeFile(
      tmp,
      JSON.stringify({ v: ENTRY_VERSION, engine: ctx.engine, diagnostics })
    )
    if (await publishEntry(tmp, target)) return
  } catch (e) {
    // 缓存写失败不影响扫描结果（fail-open）
    log.debug(`cache: entry write failed (ignored): ${String(e)}`)
  }
  await unlink(tmp).catch(() => {})
}
