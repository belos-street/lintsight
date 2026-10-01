/**
 * 分析流水线（design-m1 §4.1）：配置解析 → 收集 → Vue 虚拟块 → oxlint → 回映射 → 统一诊断 → exit code。
 * exit code 语义（M1-DR3）：0 无 error / 1 有 error / 2 运行错误（与诊断退出码严格区分），
 * 运行错误路径禁止异常逃逸（compile 实测抓到过该 bug）。
 */
import path from 'node:path'
import { rm, stat, unlink } from 'node:fs/promises'
import { runOxlint } from './oxlint-bridge'
import {
  normalizeDiagnostics,
  sortDiagnostics,
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
import { generateOxlintrc, resolveConfigFile } from '@lintsight/config-bridge'
import { createLogger, type Logger } from '@lintsight/shared'

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
    /** --fix：oxlint safe fix 就地改写虚拟文件后，差量行回写原 .vue（T1.15） */
    fix?: boolean
  } = {}
): Promise<PipelineResult> {
  const cwd = opts.cwd ?? process.cwd()
  const logger: Logger = createLogger(opts.logLevel ?? 'error')
  const cacheDir = path.resolve(cwd, CACHE_DIR_NAME)
  await rm(cacheDir, { recursive: true, force: true })

  // 配置解析：lintsight.config.json → 生成 .oxlintrc（--config 显式传入，避免自动发现歧义）
  let oxlintrcPath: string | undefined
  try {
    const configFile = resolveConfigFile(cwd, opts.config)
    if (configFile) {
      const generated = await generateOxlintrc(cwd, configFile, cacheDir)
      oxlintrcPath = generated.oxlintrcPath
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
  // 回映射表：本次运行精确路径（virtualRel → originalRel），不做模式猜测
  const virtualMap = new Map(vues.map((v) => [v.virtualRel, v.originalRel]))
  const targets = [...passthrough, ...vues.map((v) => v.virtualAbs)]

  try {
    let result
    try {
      result = await runOxlint(targets, {
        cwd,
        config: oxlintrcPath,
        fix: opts.fix
      })
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

    // 回映射 → 统一模型 → 确定性排序（M1-DR4）
    const diagnostics = sortDiagnostics(
      normalizeDiagnostics(result.output, cwd).map((d) => {
        const original = virtualMap.get(d.file)
        return toLintsightDiagnostic(original ? { ...d, file: original } : d)
      })
    )

    const summary = { error: 0, warning: 0, info: 0 }
    for (const d of diagnostics) {
      if (d.severity === 'error') summary.error++
      else if (d.severity === 'warning') summary.warning++
      else summary.info++
    }

    logger.info(
      `scanned ${result.output.number_of_files} file(s), ${diagnostics.length} diagnostic(s)`
    )

    return {
      exitCode: summary.error > 0 ? 1 : 0,
      report: {
        contractVersion: diagnostics[0]?.contractVersion ?? '1',
        files: result.output.number_of_files,
        summary,
        diagnostics
      }
    }
  } finally {
    // 就地临时文件清理：只删本次运行自己创建的（pid+序号隔离并发双跑，互不误删）
    await Promise.all(vues.map((v) => unlink(v.virtualAbs).catch(() => {})))
  }
}
