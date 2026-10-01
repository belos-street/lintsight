/**
 * 分析流水线（design-m1 §4.1）：配置解析 → 收集 → Vue 虚拟块 → 缓存筛减 → oxlint → 回映射 → 统一诊断 → exit code。
 * exit code 语义（M1-DR3）：0 无 error / 1 有 error / 2 运行错误（与诊断退出码严格区分），
 * 运行错误路径禁止异常逃逸（compile 实测抓到过该 bug）。
 *
 * 内容哈希缓存（T1.16）：未变更文件整体跳过 oxlint；--fix 模式禁用缓存读写
 * （fix 需要完整诊断面才能发现可修复项，且 fix 会改写文件使缓存失真）。
 */
import path from 'node:path'
import { stat, unlink } from 'node:fs/promises'
import pkg from '../package.json'
import { runOxlint } from './oxlint-bridge'
import {
  normalizeDiagnostics,
  normalizeFilePath,
  sortDiagnostics,
  suppressSuperseded,
  toLintsightDiagnostic,
  type LintsightDiagnostic
} from '@lintsight/diagnostic'
import {
  ensureGitignore,
  isInPlaceVirtualPath,
  virtualizeVue,
  writebackFix,
  type VirtualVueFile
} from '@lintsight/vue-processor'
import {
  generateOxlintrc,
  resolveConfigFile,
  type ArchConfig
} from '@lintsight/config-bridge'
import { createLogger, type Logger } from '@lintsight/shared'
import {
  createCacheKey,
  initCache,
  readCacheEntry,
  sha256Content,
  writeCacheEntry,
  type CacheContext
} from './cache'
import { resolveEngineBin, runEngine } from './engine-bridge'

export const CACHE_DIR_NAME = '.lintsight-cache'
const SCAN_EXTS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.vue'
])
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  CACHE_DIR_NAME,
  'dist',
  'build',
  'out',
  'coverage'
])

export interface LintsightReport {
  contractVersion: string
  files: number
  summary: { error: number; warning: number; info: number }
  diagnostics: LintsightDiagnostic[]
}

export interface PipelineResult {
  exitCode: 0 | 1 | 2
  report: LintsightReport | null
  error?: string
  /** M2 引擎降级标注（design-m2 M2-DR3 fail-open）：true = 本轮曾尝试引擎但失败，纯 M1 出结果（不进报告 JSON） */
  degraded?: boolean
}

async function collectFiles(inputs: string[], cwd: string): Promise<string[]> {
  const groups = await Promise.all(
    inputs.map(async (input) => {
      const abs = path.resolve(cwd, input)
      let st
      try {
        st = await stat(abs)
      } catch {
        throw new Error(`input path not found: ${input}`)
      }
      if (st.isFile()) {
        if (isInPlaceVirtualPath(abs)) return []
        return SCAN_EXTS.has(path.extname(abs)) ? [abs] : []
      }
      if (!st.isDirectory()) throw new Error(`unsupported input type: ${input}`)
      const glob = new Bun.Glob('**/*')
      const matched: string[] = []
      for (const rel of glob.scanSync({ cwd: abs, onlyFiles: true })) {
        if (rel.split('/').some((seg) => IGNORED_DIRS.has(seg))) continue
        if (isInPlaceVirtualPath(rel)) continue // 本次/历史运行的就地临时文件不重复扫描
        if (SCAN_EXTS.has(path.extname(rel)))
          matched.push(path.resolve(abs, rel))
      }
      return matched
    })
  )
  return groups.flat().sort()
}

export async function runPipeline(
  inputs: string[],
  opts: {
    cwd?: string
    config?: string
    logLevel?: 'debug' | 'info' | 'warn' | 'error'
    /** --fix：oxlint safe fix 就地改写虚拟文件后，差量行回写原 .vue（T1.15）；禁用缓存 */
    fix?: boolean
    /** 内容哈希缓存（T1.16），默认开启；--no-cache 关闭 */
    cache?: boolean
  } = {}
): Promise<PipelineResult> {
  const cwd = opts.cwd ?? process.cwd()
  const logger: Logger = createLogger(opts.logLevel ?? 'error')
  // 缓存条目须跨运行存活：cacheDir 只在启动时确保存在，不再整体清空（oxlintrc 每次覆盖生成）
  const cacheDir = path.resolve(cwd, CACHE_DIR_NAME)

  // 配置解析：lintsight.config.json → 生成 .oxlintrc（--config 显式传入，避免自动发现歧义）
  let oxlintrcPath: string | undefined
  let arch: ArchConfig | undefined
  try {
    const configFile = resolveConfigFile(cwd, opts.config)
    if (configFile) {
      const generated = await generateOxlintrc(cwd, configFile, cacheDir)
      oxlintrcPath = generated.oxlintrcPath
      arch = generated.arch
      logger.info(`config: ${configFile} → ${oxlintrcPath}`)
    } else {
      logger.info(
        'no lintsight.config.json found, falling back to oxlint config discovery'
      )
    }
  } catch (e) {
    return { exitCode: 2, report: null, error: (e as Error).message }
  }

  let files: string[]
  try {
    files = await collectFiles(inputs, cwd)
  } catch (e) {
    return { exitCode: 2, report: null, error: (e as Error).message }
  }
  if (files.length === 0) {
    return { exitCode: 2, report: null, error: 'no scannable files found' }
  }

  // .vue → 就地临时虚拟块（同目录保 import 解析上下文；行号 1:1 对齐）；各文件互相独立，并行虚拟化
  const vueFiles = files.filter((f) => f.endsWith('.vue'))
  const passthrough = files.filter((f) => !f.endsWith('.vue'))
  const virtualized = await Promise.all(
    vueFiles.map((f) => virtualizeVue(f, cwd))
  )
  const vues = virtualized.filter((v): v is VirtualVueFile => v !== null)
  for (const v of vues) {
    for (const w of v.warnings) logger.warn(`${v.originalRel}: ${w}`)
  }
  if (vues.length > 0) await ensureGitignore(cwd)

  // 缓存筛减（T1.16）：units = 本次运行的扫描单元；storeRel = 诊断归属文件（vue 回映射后的原路径）
  const relOf = (abs: string) => normalizeFilePath(abs, cwd)
  const units = [
    ...passthrough.map((abs) => ({
      scanAbs: abs,
      contentAbs: abs,
      storeRel: relOf(abs)
    })),
    ...vues.map((v) => ({
      scanAbs: v.virtualAbs,
      contentAbs: v.originalAbs,
      storeRel: v.originalRel
    }))
  ]

  let cacheCtx: CacheContext = {
    enabled: false,
    dir: path.join(cacheDir, 'cache'),
    engine: 'disabled',
    config: '',
    plugin: ''
  }
  if ((opts.cache ?? true) && !opts.fix) {
    cacheCtx = await initCache({
      cwd,
      oxlintrcPath,
      lintsightVersion: pkg.version,
      engineBin: resolveEngineBin(cwd)
    })
  }

  const results = new Map<string, LintsightDiagnostic[]>()
  const misses: {
    scanAbs: string
    scanRel: string
    storeRel: string
    key: string
  }[] = []
  let hits = 0
  if (cacheCtx.enabled) {
    await Promise.all(
      units.map(async (u) => {
        const hash = await sha256Content(u.contentAbs)
        if (hash !== null) {
          const key = createCacheKey(cacheCtx, hash)
          const entry = await readCacheEntry(cacheCtx, key)
          if (entry) {
            hits++
            results.set(u.storeRel, entry)
            return
          }
          misses.push({
            scanAbs: u.scanAbs,
            scanRel: relOf(u.scanAbs),
            storeRel: u.storeRel,
            key
          })
        } else {
          misses.push({
            scanAbs: u.scanAbs,
            scanRel: relOf(u.scanAbs),
            storeRel: u.storeRel,
            key: ''
          })
        }
      })
    )
  } else {
    for (const u of units) {
      misses.push({
        scanAbs: u.scanAbs,
        scanRel: relOf(u.scanAbs),
        storeRel: u.storeRel,
        key: ''
      })
    }
  }

  try {
    const missMap = new Map(misses.map((m) => [m.scanRel, m]))
    let scannedFiles = 0
    let degraded = false
    if (misses.length > 0) {
      let result
      try {
        result = await runOxlint(
          misses.map((m) => m.scanAbs),
          { cwd, config: oxlintrcPath, fix: opts.fix }
        )
      } catch (e) {
        // oxlint 不可得（未安装且未设 OXLINT_BIN）等运行错误 → exit 2
        return { exitCode: 2, report: null, error: (e as Error).message }
      }
      if (!result.ok || !result.output) {
        return {
          exitCode: 2,
          report: null,
          error: `oxlint runtime failure (exit=${result.exitCode}): ${result.stderr.slice(0, 500)}`
        }
      }
      scannedFiles = result.output.number_of_files

      // --fix：oxlint 已就地改写虚拟文件 → 差量行回写原 .vue（T1.15；仅行数不变的 safe fix）
      if (opts.fix) {
        const wbs = await Promise.all(
          vues.map(async (v) => ({
            v,
            wb: await writebackFix(v.originalAbs, v.virtualAbs)
          }))
        )
        for (const { v, wb } of wbs) {
          if (wb.changed)
            logger.info(`fix: ${v.originalRel} (${wb.lines} line(s))`)
          else if (wb.skipped)
            logger.warn(
              `fix: ${v.originalRel} skipped — fix 改变行数，M1 仅回写行数不变的 safe fix`
            )
        }
      }

      // 回映射（scanRel → storeRel）→ 统一模型 → 按文件分组（= 缓存条目粒度）
      const engineResult = await runEngine(
        misses.map((m) => m.scanRel),
        {
          cwd,
          arch
        }
      )
      if (engineResult.degraded) {
        logger.warn(
          'engine: M2 sidecar 降级（启动/协议失败），本轮为纯 M1 扫描'
        )
      }

      for (const d of normalizeDiagnostics(result.output, cwd)) {
        const storeRel = missMap.get(d.file)?.storeRel ?? d.file
        const diag = toLintsightDiagnostic({ ...d, file: storeRel })
        const group = results.get(storeRel)
        if (group) group.push(diag)
        else results.set(storeRel, [diag])
      }

      // M2 引擎诊断合并（design-m2 §4.3；协议 file = --root 相对路径，missMap 键同口径）
      if (engineResult.diagnostics) {
        for (const ed of engineResult.diagnostics) {
          const storeRel = missMap.get(ed.file)?.storeRel ?? ed.file
          const diag = toLintsightDiagnostic({
            ruleId: ed.ruleId,
            severity: ed.severity,
            message: ed.message,
            file: storeRel,
            span: ed.span
          })
          const group = results.get(storeRel)
          if (group) group.push(diag)
          else results.set(storeRel, [diag])
        }
      }
      degraded = engineResult.degraded

      // 缓存回写：只写本次真实扫描且内容哈希可得的文件
      await Promise.all(
        misses.map((m) => {
          const group = results.get(m.storeRel)
          return m.key && group
            ? writeCacheEntry(cacheCtx, m.key, group)
            : Promise.resolve()
        })
      )
    }

    // 合并（缓存命中 + 本次扫描）→ 双报消解（M2 §4.4：数据流版抑制同位置语法级版）
    // → 确定性排序（M1-DR4）
    const diagnostics = sortDiagnostics(
      suppressSuperseded([...results.values()].flat())
    )

    const summary = { error: 0, warning: 0, info: 0 }
    for (const d of diagnostics) {
      if (d.severity === 'error') summary.error++
      else if (d.severity === 'warning') summary.warning++
      else summary.info++
    }

    logger.info(
      `scanned ${scannedFiles} file(s) (cache: ${hits} hit / ${misses.length} miss), ${diagnostics.length} diagnostic(s)`
    )

    return {
      exitCode: summary.error > 0 ? 1 : 0,
      degraded,
      report: {
        contractVersion: diagnostics[0]?.contractVersion ?? '1',
        files: units.length,
        summary,
        diagnostics
      }
    }
  } finally {
    // 就地临时文件清理：只删本次运行自己创建的（pid+序号隔离并发双跑，互不误删）
    await Promise.all(vues.map((v) => unlink(v.virtualAbs).catch(() => {})))
  }
}
