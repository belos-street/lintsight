/** 日志分级（@lintsight/shared）。日志一律走 stderr——stdout 保留给报告输出。 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

export interface Logger {
  debug(message: string): void
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

export function createLogger(level: LogLevel = 'error'): Logger {
  const min = ORDER[level]
  const emit = (lvl: LogLevel) => (message: string) => {
    if (ORDER[lvl] < min) return
    console.error(`[lintsight:${lvl}] ${message}`)
  }
  return { debug: emit('debug'), info: emit('info'), warn: emit('warn'), error: emit('error') }
}
