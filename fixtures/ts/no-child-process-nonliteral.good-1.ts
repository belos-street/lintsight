// valid-1：字面量命令
import cp from 'node:child_process'

export function runLiteral(cb: (e: unknown, out: unknown) => void) {
  return cp.exec('ls -la', cb)
}
