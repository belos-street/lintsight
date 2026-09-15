/**
 * 分析流水线（SV6）：收集 → Vue 虚拟块 → oxlint → 回映射 → 统一诊断 → exit code。
 * exit code 语义（§6.3）：0 无 error / 1 有 error / 2 运行错误（与诊断退出码严格区分）。
 * oxlint 自身 exit=1 同时表示「有 error」和「输入不存在」（实测），
 * 因此运行错误判定由本层负责：输入不存在 / 无可扫文件 / 进程失败 / JSON 不可解析。
 */
import path from 'node:path'
import { rm } from 'node:fs/promises'
import { stat } from 'node:fs/promises'
import { runOxlint } from './oxlint-bridge'
import { inverseVirtualPath, virtualizeVue } from './vue-processor'
import {
  CONTRACT_VERSION,
  toLintsightDiagnostic,
  type LintsightDiagnostic
} from './diagnostic'

export const CACHE_DIR_NAME = '.lintsight-cache'
const CACHE_PREFIX = `${CACHE_DIR_NAME}/`
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
      if (st.isFile()) return SCAN_EXTS.has(path.extname(abs)) ? [abs] : []
      if (!st.isDirectory()) throw new Error(`unsupported input type: ${input}`)
      const glob = new Bun.Glob('**/*')
      const matched: string[] = []
      for (const rel of glob.scanSync({ cwd: abs, onlyFiles: true })) {
        if (rel.split('/').some((seg) => IGNORED_DIRS.has(seg))) continue
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
  opts: { cwd?: string; config?: string } = {}
): Promise<PipelineResult> {
  const cwd = opts.cwd ?? process.cwd()
  const cacheDir = path.resolve(cwd, CACHE_DIR_NAME)
  await rm(cacheDir, { recursive: true, force: true })

  let files: string[]
  try {
    files = await collectFiles(inputs, cwd)
  } catch (e) {
    return { exitCode: 2, report: null, error: (e as Error).message }
  }
  if (files.length === 0) {
    return { exitCode: 2, report: null, error: 'no scannable files found' }
  }

  // .vue → 虚拟块（行号 1:1 对齐，回映射只改路径）；各文件互相独立，并行虚拟化
  const vueFiles = files.filter((f) => f.endsWith('.vue'))
  const passthrough = files.filter((f) => !f.endsWith('.vue'))
  const virtualized = await Promise.all(
    vueFiles.map((f) => virtualizeVue(f, cwd, cacheDir))
  )
  const targets = [
    ...passthrough,
    ...virtualized.filter((v) => v !== null).map((v) => v!.virtualAbs)
  ]

  let result
  try {
    result = await runOxlint(targets, { cwd, config: opts.config })
  } catch (e) {
    // oxlint 不可得（未安装且未设 OXLINT_BIN）等运行错误 → exit 2，不允许异常逃逸破坏 exit code 语义
    return { exitCode: 2, report: null, error: (e as Error).message }
  }
  if (!result.ok || !result.output) {
    return {
      exitCode: 2,
      report: null,
      error: `oxlint runtime failure (exit=${result.exitCode}): ${result.stderr.slice(0, 500)}`
    }
  }

  // 回映射 → 统一模型 → 确定性排序（并行扫描下保证 JSON 与指纹跨运行稳定）
  const diagnostics = result.normalized
    .map((d) => {
      const original = inverseVirtualPath(d.file, CACHE_PREFIX)
      return original ? { ...d, file: original } : d
    })
    .map(toLintsightDiagnostic)
    .sort(
      (a, b) =>
        a.file.localeCompare(b.file) ||
        a.span.offset - b.span.offset ||
        a.ruleId.localeCompare(b.ruleId)
    )

  const summary = { error: 0, warning: 0, info: 0 }
  for (const d of diagnostics) {
    if (d.severity === 'error') summary.error++
    else if (d.severity === 'warning') summary.warning++
    else summary.info++
  }

  return {
    exitCode: summary.error > 0 ? 1 : 0,
    report: {
      contractVersion: CONTRACT_VERSION,
      files: result.output.number_of_files,
      summary,
      diagnostics
    }
  }
}
