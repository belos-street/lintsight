import pkg from '../package.json'
import path from 'node:path'
import { runPipeline } from './pipeline'
import {
  formatters,
  type FormatName,
  type SarifRuleMeta
} from '@lintsight/formatter'
import { registry } from '@lintsight/diagnostic/registry'
import { createLogger, type LogLevel } from '@lintsight/shared'

const args = process.argv.slice(2)

const usage = `lintsight v${pkg.version} — usage: lintsight <paths...> [--config <lintsight.config.json>] [--format json|text|sarif] [--output <file>] [--log-level debug|info|warn|error] [--fail-on high|medium|low] [--fix] [--no-cache]`

function readOption(name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

if (args.includes('--version') || args.includes('-v')) {
  console.log(`lintsight v${pkg.version}`)
  process.exit(0)
}
if (args.includes('--help') || args.includes('-h')) {
  console.log(usage)
  process.exit(0)
}

const format = readOption('--format') ?? 'json'
if (!(format in formatters)) {
  console.error(`lintsight: --format 期望 json|text|sarif，得到 '${format}'`)
  process.exit(2)
}
const logLevel = readOption('--log-level') ?? 'error'
if (!['debug', 'info', 'warn', 'error'].includes(logLevel)) {
  console.error(
    `lintsight: --log-level 期望 debug|info|warn|error，得到 '${logLevel}'`
  )
  process.exit(2)
}
// 契约 v3：CI 门禁阈值；缺省 low = 现有「任何 error 即 1」
const failOn = readOption('--fail-on') ?? 'low'
if (!['high', 'medium', 'low'].includes(failOn)) {
  console.error(`lintsight: --fail-on 期望 high|medium|low，得到 '${failOn}'`)
  process.exit(2)
}

const optionNames = [
  '--format',
  '--log-level',
  '--config',
  '--output',
  '--fail-on'
]
const paths = args.filter(
  (a, i) => !a.startsWith('-') && !optionNames.includes(args[i - 1]) // 前一个是选项名 → 当前是选项值
)

if (paths.length === 0) {
  console.error(usage)
  process.exit(2)
}

const logger = createLogger(logLevel as LogLevel)
const result = await runPipeline(paths, {
  config: readOption('--config'),
  logLevel: logLevel as LogLevel,
  failOn: failOn as 'high' | 'medium' | 'low',
  fix: args.includes('--fix'),
  cache: !args.includes('--no-cache')
})
if (result.error) logger.error(result.error)
if (result.report) {
  // SARIF 规则目录：注册表 → SarifRuleMeta（helpUri 仅自有规则给规则面锚点）
  const ruleCatalog: SarifRuleMeta[] = registry.map((e) => ({
    id: e.ruleId,
    name: e.ruleId.split('/').pop()!,
    shortDescription: e.description,
    defaultLevel: e.defaultSeverity === 'error' ? 'error' : 'warning',
    ...(e.ruleId.startsWith('lintsight')
      ? { helpUri: 'https://github.com/belos-street/lintsight#规则面' }
      : {}),
    ...(e.cweTags?.length ? { cweTags: e.cweTags } : {})
  }))
  const formatted = formatters[format as FormatName](result.report, {
    toolVersion: pkg.version,
    rules: ruleCatalog
  })
  const output = readOption('--output')
  if (output) {
    // 契约 v3：--output 时 stdout 必须为空（报告只落文件；日志走 stderr）
    await Bun.write(path.resolve(output), formatted)
    logger.info(`report written: ${path.resolve(output)}`)
  } else {
    console.log(formatted)
  }
}
process.exit(result.exitCode)
