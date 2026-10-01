import pkg from '../package.json'
import path from 'node:path'
import { runPipeline } from './pipeline'
import { formatters, type FormatName } from '@lintsight/formatter'
import { createLogger, type LogLevel } from '@lintsight/shared'

const args = process.argv.slice(2)

const usage = `lintsight v${pkg.version} — usage: lintsight <paths...> [--config <lintsight.config.json>] [--format json|text|sarif] [--output <file>] [--log-level debug|info|warn|error] [--fix] [--no-cache]`

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

const optionNames = ['--format', '--log-level', '--config', '--output']
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
  fix: args.includes('--fix'),
  cache: !args.includes('--no-cache')
})
if (result.error) logger.error(result.error)
if (result.report) {
  const formatted = formatters[format as FormatName](result.report)
  const output = readOption('--output')
  if (output) {
    // 报告落盘（平台对接 / IDE 浏览）；stdout 行为不变
    await Bun.write(path.resolve(output), formatted)
    logger.info(`report written: ${path.resolve(output)}`)
  }
  console.log(formatted)
}
process.exit(result.exitCode)
