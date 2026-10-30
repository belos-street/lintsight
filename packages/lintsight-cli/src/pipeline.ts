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
  applySuppressions,
  CONTRACT_VERSION,
  normalizeDiagnostics,
  normalizeFilePath,
  parseInlineSuppressions,
  refreshDiagnosticMetadata,
  sortDiagnostics,
  suppressSuperseded,
  toLintsightDiagnostic,
  type Confidence,
  type EngineStatus,
  type FileSuppressions,
  type LintsightDiagnostic,
  type OxlintJsonOutput
} from '@lintsight/diagnostic'
import {
  ensureGitignore,
  isInPlaceVirtualPath,
  virtualizeVue,
  writebackFix,
  type VirtualVueFile
} from '@lintsight/vue-processor'
import {
  createIgnoreMatcher,
  generateOxlintrc,
  resolveConfigFile,
  type ArchConfig,
  type IgnoreMatcher
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
import {
  DEFAULT_ENGINE_TIMEOUT_MS,
  discoverTsconfigs,
  resolveEngineBin,
  resolveTsPaths,
  runEngine
} from './engine-bridge'

export const CACHE_DIR_NAME = '.lintsight-cache'
/** Windows CreateProcess 命令行上限 32767 字符：大批文件按累计长度切批，
 * 否则 500 个绝对路径即触发 ENAMETOOLONG（uv_spawn 失败）。 */
function chunkPaths(paths: string[], maxChars = 28000): string[][] {
  const chunks: string[][] = []
  let cur: string[] = []
  let len = 0
  for (const p of paths) {
    if (cur.length > 0 && len + p.length > maxChars) {
      chunks.push(cur)
      cur = []
      len = 0
    }
    cur.push(p)
    len += p.length + 3
  }
  if (cur.length > 0) chunks.push(cur)
  return chunks
}
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
  // 常规构建产物目录（B2：默认不进扫描面）
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  '.output',
  '.svelte-kit',
  '.turbo',
  '.parcel-cache',
  '.vercel'
])

/** 打包产物判据（B2）：只对 JS 产物扩展名生效，探针前 64KB 内出现 ≥1500 字符长行。
 * 打包产物（Vite/webpack/rollup）本质是「极少数超长行」；阈值经语料实测校准——
 * corpus 内手写长行文件（ghost 邮件模板/setup.js 等）最长 1316，真压缩产物最短 1685，
 * 1500 落在分界带上；压缩但整体行较短的产物（如 stats.min.js 572）由文件名模式覆盖。
 * .ts/.tsx/.vue 永不参与（手写源码不存在压缩形态）；探针窗口是性能折衷（只读文件头）。
 * 读取失败一律 false（fail-open：宁可多扫，不可静默漏扫）。 */
const BUNDLE_EXTS = new Set(['.js', '.mjs', '.cjs'])
const GENERATED_PROBE_BYTES = 64 * 1024
const GENERATED_MIN_LINE = 1500

async function looksLikeGeneratedBundle(abs: string): Promise<boolean> {
  if (!BUNDLE_EXTS.has(path.extname(abs))) return false
  try {
    const head = await Bun.file(abs).slice(0, GENERATED_PROBE_BYTES).text()
    return head.split('\n').some((l) => l.length >= GENERATED_MIN_LINE)
  } catch {
    return false
  }
}

/** 读取有诊断的文件并解析行内抑制指令（G2）。
 * 只读报告涉及的 file（.vue 读原文件）；读失败/文件已删 → 无指令，fail-open。 */
async function loadInlineSuppressions(
  cwd: string,
  diagnostics: LintsightDiagnostic[]
): Promise<Map<string, FileSuppressions>> {
  const files = new Set(diagnostics.map((d) => d.file))
  const out = new Map<string, FileSuppressions>()
  await Promise.all(
    [...files].map(async (file) => {
      try {
        const text = await Bun.file(path.resolve(cwd, file)).text()
        out.set(file, parseInlineSuppressions(text))
      } catch (e) {
        // 读失败不阻塞报告（抑制是增强能力，不是扫描前置条件）
        void e
      }
    })
  )
  return out
}

/** G6：引擎进程超时（override > env > 默认 120s；env 0 = 禁用） */
function resolveEngineTimeoutMs(
  override: number | undefined,
  logger: Logger
): number {
  if (override !== undefined) return override
  const raw = process.env.LINTSIGHT_ENGINE_TIMEOUT_MS
  if (!raw) return DEFAULT_ENGINE_TIMEOUT_MS
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 0) {
    logger.warn(
      `engine: LINTSIGHT_ENGINE_TIMEOUT_MS 非法（'${raw}'），使用默认 ${DEFAULT_ENGINE_TIMEOUT_MS}ms`
    )
    return DEFAULT_ENGINE_TIMEOUT_MS
  }
  return n
}

export interface LintsightReport {
  contractVersion: string
  /** 契约 v3：单一版本源（G14 前取 CLI 包版本） */
  toolVersion: string
  /** 契约 v3：引擎可用性（missing 不再静默） */
  engineStatus: EngineStatus
  files: number
  summary: { error: number; warning: number; info: number; suppressed: number }
  diagnostics: LintsightDiagnostic[]
}

export interface PipelineResult {
  exitCode: 0 | 1 | 2
  report: LintsightReport | null
  error?: string
  /** M2 引擎降级标注（design-m2 M2-DR3 fail-open）：true = 本轮曾尝试引擎但失败，纯 M1 出结果（不进报告 JSON） */
  degraded?: boolean
  /** G1 缓存统计（测试/排障用；不进报告 JSON） */
  cache?: { enabled: boolean; hits: number; misses: number }
}

interface Collected {
  files: string[]
  /** 被 ignore 模式排除的候选文件数（无可扫文件时用于给出可操作提示） */
  ignored: number
}

/** 收集扫描目标（B1：ignore 在此落地——pipeline 侧过滤，模式相对扫描根或项目根匹配） */
async function collectFiles(
  inputs: string[],
  cwd: string,
  ignore: IgnoreMatcher | null
): Promise<Collected> {
  const toPosix = (p: string) => p.split(path.sep).join('/')
  // 扫描根相对路径优先（`bun run cli -- packages/foo` 时 src/gen/** 这类根相对模式才有意义），
  // 同时接受项目根相对路径（cwd 场景）；两者任一命中即忽略
  const ignored = (abs: string, rootRel?: string): boolean => {
    if (!ignore) return false
    if (rootRel !== undefined && ignore.matches(rootRel)) return true
    const relCwd = toPosix(path.relative(cwd, abs))
    return !relCwd.startsWith('..') && ignore.matches(relCwd)
  }
  let ignoredCount = 0
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
        if (!SCAN_EXTS.has(path.extname(abs))) return []
        if (ignored(abs)) {
          ignoredCount++
          return []
        }
        return [abs]
      }
      if (!st.isDirectory()) throw new Error(`unsupported input type: ${input}`)
      const glob = new Bun.Glob('**/*')
      const matched: string[] = []
      for (const rawRel of glob.scanSync({ cwd: abs, onlyFiles: true })) {
        // Bun.Glob 在 Windows 返回反斜杠分隔 → 统一 POSIX 后再做段匹配
        const rel = rawRel.replace(/\\/g, '/')
        if (rel.split('/').some((seg) => IGNORED_DIRS.has(seg))) continue
        if (isInPlaceVirtualPath(rel)) continue // 本次/历史运行的就地临时文件不重复扫描
        if (!SCAN_EXTS.has(path.extname(rel))) continue
        const fileAbs = path.resolve(abs, rel)
        if (ignored(fileAbs, rel)) {
          ignoredCount++
          continue
        }
        matched.push(fileAbs)
      }
      return matched
    })
  )
  return { files: groups.flat().sort(), ignored: ignoredCount }
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
    /** 契约 v3：CI 门禁置信度阈值（缺省 low = 现有「任何 error 即 1」） */
    failOn?: Confidence
    /** G6：引擎非 ok 时 fail-closed（exit 2，但保留报告）；缺省 fail-open */
    failClosed?: boolean
    /** G6：引擎进程超时（0 = 禁用；缺省 env/120s） */
    engineTimeoutMs?: number
  } = {}
): Promise<PipelineResult> {
  const cwd = opts.cwd ?? process.cwd()
  const logger: Logger = createLogger(opts.logLevel ?? 'error')
  // 缓存条目须跨运行存活：cacheDir 只在启动时确保存在，不再整体清空（oxlintrc 每次覆盖生成）
  const cacheDir = path.resolve(cwd, CACHE_DIR_NAME)

  // 配置解析：lintsight.config.json → 生成 .oxlintrc（--config 显式传入，避免自动发现歧义）
  let oxlintrcPath: string | undefined
  let arch: ArchConfig | undefined
  let typeAware: boolean | undefined
  let ignoreMatcher: IgnoreMatcher | null = null
  let ignoreGenerated = true
  let suppressVueUnusedVars = false
  try {
    const configFile = resolveConfigFile(cwd, opts.config)
    if (configFile) {
      const generated = await generateOxlintrc(cwd, configFile, cacheDir)
      oxlintrcPath = generated.oxlintrcPath
      arch = generated.arch
      typeAware = generated.typeAware
      // B1：ignore 由 pipeline 侧匹配（oxlint 的 ignorePatterns 相对 oxlintrc 目录
      // 解析，而生成配置在 .lintsight-cache/ → 用户模式不可达，见 config-bridge 注释）
      ignoreMatcher = createIgnoreMatcher(generated.ignore)
      for (const p of ignoreMatcher.invalid) {
        logger.warn(`ignore: 模式无法解析，已跳过 → '${p}'（不支持 .. 等形态）`)
      }
      ignoreGenerated = generated.ignoreGenerated
      suppressVueUnusedVars = generated.suppressVueUnusedVars
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
  let ignoredCount = 0
  let skippedGenerated = 0
  try {
    const collected = await collectFiles(inputs, cwd, ignoreMatcher)
    files = collected.files
    ignoredCount = collected.ignored
    // B2：疑似打包/压缩产物跳过（可见 + 可关：ignoreGenerated: false）
    if (ignoreGenerated) {
      const flags = await Promise.all(
        files.map((f) => looksLikeGeneratedBundle(f))
      )
      const skipped = files.filter((_, i) => flags[i])
      skippedGenerated = skipped.length
      if (skipped.length > 0) {
        logger.warn(
          `generated: 跳过 ${skipped.length} 个疑似打包/压缩产物（长行 ≥ ${GENERATED_MIN_LINE} 字符；ignoreGenerated: false 可关闭）`
        )
        for (const f of skipped.slice(0, 10)) {
          logger.info(`generated: ${normalizeFilePath(f, cwd)}`)
        }
      }
      files = files.filter((_, i) => !flags[i])
    }
  } catch (e) {
    return { exitCode: 2, report: null, error: (e as Error).message }
  }
  if (files.length === 0) {
    // 有过滤发生时给出可操作提示；否则保持原契约文案（exit 2 契约测试锁定）
    const filtered = ignoredCount + skippedGenerated
    return {
      exitCode: 2,
      report: null,
      error:
        filtered > 0
          ? `no scannable files found（${filtered} 个候选文件被 ignore / ignoreGenerated 过滤）`
          : 'no scannable files found'
    }
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

  // G1：tsconfig 发现一次，缓存指纹与引擎别名解析共用同一份列表
  const tsconfigFiles = discoverTsconfigs(cwd, inputs)

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
      engineBin: resolveEngineBin(cwd),
      tsconfigFiles
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
          // G1：键含路径与 tsconfig 指纹；空数组是合法命中（干净文件已缓存）
          const key = createCacheKey(cacheCtx, u.storeRel, hash)
          const entry = await readCacheEntry(cacheCtx, key)
          if (entry !== null) {
            hits++
            // G2：缓存命中后按当前 registry 水合 confidence/cweTags（抑制在合并后应用）
            results.set(u.storeRel, entry.map(refreshDiagnosticMetadata))
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
    // G1：引擎输入 = 全部扫描单元（图规则需要完整文件集）；回映射用全量 unitMap
    const unitMap = new Map(units.map((u) => [relOf(u.scanAbs), u.storeRel]))
    let scannedFiles = 0
    if (misses.length > 0) {
      const batches = chunkPaths(misses.map((m) => m.scanAbs))
      // 分批 spawn：各批输出按诊断数组拼接（文件级独立，无跨批语义）
      const scanBatches = async (extra: { typeAware?: boolean } = {}) => {
        const merged: OxlintJsonOutput = {
          diagnostics: [],
          number_of_files: 0,
          number_of_rules: 0
        }
        // 各批互相独立（文件级隔离），并行 spawn 后合并；最终排序保证确定性
        const rs = await Promise.all(
          batches.map((batch) =>
            runOxlint(batch, {
              cwd,
              config: oxlintrcPath,
              fix: opts.fix,
              ...extra
            })
          )
        )
        let lastExit = 0
        for (const r of rs) {
          if (!r.ok || !r.output) return r
          merged.diagnostics.push(...r.output.diagnostics)
          merged.number_of_files += r.output.number_of_files
          merged.number_of_rules = Math.max(
            merged.number_of_rules,
            r.output.number_of_rules
          )
          lastExit = Math.max(lastExit, r.exitCode)
        }
        return { ok: true, exitCode: lastExit, stderr: '', output: merged }
      }
      let result
      try {
        result = await scanBatches(typeAware ? { typeAware: true } : undefined)
      } catch (e) {
        // oxlint 不可得（未安装且未设 OXLINT_BIN）等运行错误 → exit 2
        return { exitCode: 2, report: null, error: (e as Error).message }
      }
      // FR-305 降级：type-aware 启用但 tsgolint 伴生依赖缺失/不可用 →
      // 自动回落纯 M1 重试一次并提示（没结果比没 type-aware 更糟，fail-open 同纪律）
      if (!result.ok && typeAware) {
        result = await scanBatches()
        logger.warn(
          'type-aware 降级：oxlint --type-aware 不可用（oxlint-tsgolint 未安装或版本不支持），本轮为纯 M1 扫描'
        )
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

      // M1 回映射（oxlint 只扫 miss；scanRel → storeRel）→ 统一模型 → 按文件分组
      for (const d of normalizeDiagnostics(result.output, cwd)) {
        const storeRel = missMap.get(d.file)?.storeRel ?? d.file
        const diag = toLintsightDiagnostic({ ...d, file: storeRel })
        const group = results.get(storeRel)
        if (group) group.push(diag)
        else results.set(storeRel, [diag])
      }

      // 缓存回写（G1）：干净文件写空数组；只写 M1 诊断，引擎诊断不落盘
      await Promise.all(
        misses.map((m) =>
          m.key
            ? writeCacheEntry(cacheCtx, m.key, results.get(m.storeRel) ?? [])
            : Promise.resolve()
        )
      )
    }

    // 引擎全量 pass（G1）：图规则需要当前完整文件集；结果每轮重算、不进缓存。
    // FR-304：tsconfig paths 归一化表随 stdin 下发引擎（arch 别名兜底；fail-open）
    // 发现范围 = 扫描根 + cwd 根 tsconfig（discoverTsconfigs 已复用同一列表）
    const tsPaths = await resolveTsPaths(cwd, inputs, tsconfigFiles)
    const engineResult = await runEngine(
      units.map((u) => relOf(u.scanAbs)),
      {
        cwd,
        arch,
        tsPaths,
        logger,
        timeoutMs: resolveEngineTimeoutMs(opts.engineTimeoutMs, logger)
      }
    )
    // G6：所有非 ok 状态统一可见（含 missing）；fail-open 下仍出纯 M1 结果
    if (engineResult.status !== 'ok') {
      logger.warn(
        `engine: status=${engineResult.status}（fail-open，本轮为纯 M1 结果）`
      )
    }
    const degraded = engineResult.degraded

    // M2 引擎诊断合并（design-m2 §4.3；协议 file = --root 相对路径，unitMap 键同口径）
    const engineGroups = new Map<string, LintsightDiagnostic[]>()
    if (engineResult.diagnostics) {
      for (const ed of engineResult.diagnostics) {
        const storeRel = unitMap.get(ed.file) ?? ed.file
        const diag = toLintsightDiagnostic({
          ruleId: ed.ruleId,
          severity: ed.severity,
          message: ed.message,
          file: storeRel,
          span: ed.span,
          // 契约 v2：taint 证据链透传（SARIF codeFlows/relatedLocations 消费）
          pathEvents: ed.pathEvents,
          // 契约 v3：逐 finding 置信度覆盖（引擎未发送时取 registry 默认）
          confidence: ed.confidence
        })
        const group = engineGroups.get(storeRel)
        if (group) group.push(diag)
        else engineGroups.set(storeRel, [diag])
      }
    }

    // Vue SFC 虚拟块只含 <script>，template 引用不可见 → 内置 no-unused-vars
    // 系统性误报（默认抑制；用户显式配置该规则时 config-bridge 会关闭本开关）
    let mergedDiagnostics = [
      ...results.values(),
      ...engineGroups.values()
    ].flat()
    let suppressedVueUnused = 0
    if (suppressVueUnusedVars) {
      const vueRels = new Set(vues.map((v) => v.originalRel))
      mergedDiagnostics = mergedDiagnostics.filter((d) => {
        const hit = d.ruleId === 'eslint/no-unused-vars' && vueRels.has(d.file)
        if (hit) suppressedVueUnused++
        return !hit
      })
    }
    if (suppressedVueUnused > 0) {
      logger.info(
        `vue: 抑制 ${suppressedVueUnused} 条 eslint/no-unused-vars（template 引用不可见；rules 显式配置可恢复）`
      )
    }

    // 合并（缓存命中 + 本次扫描）→ 双报消解（M2 §4.4：数据流版抑制同位置语法级版）
    // → 确定性排序（M1-DR4）
    const ordered = sortDiagnostics(suppressSuperseded(mergedDiagnostics))

    // G2：行内抑制（缓存命中后每轮重算；被抑制诊断保留并带审计字段）
    const suppressionIndex = await loadInlineSuppressions(cwd, ordered)
    const applied = applySuppressions(ordered, suppressionIndex)
    for (const issue of applied.invalid) {
      logger.warn(
        `suppression: ${issue.file}:${issue.line} 指令无效（${issue.code}），已忽略`
      )
    }
    const diagnostics = applied.diagnostics

    const summary = { error: 0, warning: 0, info: 0, suppressed: 0 }
    for (const d of diagnostics) {
      // 被抑制诊断保留在报告中供审计，但不计入 summary / exit / fail-on
      if (d.suppression) {
        summary.suppressed++
        continue
      }
      if (d.severity === 'error') summary.error++
      else if (d.severity === 'warning') summary.warning++
      else summary.info++
    }

    // 契约 v3：--fail-on 置信度阈值（缺省 low = 现有「任何 error 即 1」）
    const failRank: Record<Confidence, number> = { low: 1, medium: 2, high: 3 }
    const failOn = opts.failOn ?? 'low'
    const failing = diagnostics.some(
      (d) =>
        !d.suppression &&
        d.severity === 'error' &&
        failRank[d.confidence] >= failRank[failOn]
    )

    logger.info(
      `scanned ${scannedFiles} file(s) (cache: ${hits} hit / ${misses.length} miss), ${diagnostics.length} diagnostic(s)`
    )

    const report: LintsightReport = {
      contractVersion: diagnostics[0]?.contractVersion ?? CONTRACT_VERSION,
      toolVersion: pkg.version,
      engineStatus: engineResult.status,
      files: units.length,
      summary,
      diagnostics
    }

    // G6：可选 fail-closed —— 引擎非 ok 即 exit 2，但保留报告（engineStatus 可见）
    if (opts.failClosed && engineResult.status !== 'ok') {
      return {
        exitCode: 2,
        degraded,
        error: `engine fail-closed: status=${engineResult.status}`,
        cache: { enabled: cacheCtx.enabled, hits, misses: misses.length },
        report
      }
    }

    return {
      exitCode: failing ? 1 : 0,
      degraded,
      cache: { enabled: cacheCtx.enabled, hits, misses: misses.length },
      report
    }
  } finally {
    // 就地临时文件清理：只删本次运行自己创建的（pid+序号隔离并发双跑，互不误删）
    await Promise.all(vues.map((v) => unlink(v.virtualAbs).catch(() => {})))
  }
}
