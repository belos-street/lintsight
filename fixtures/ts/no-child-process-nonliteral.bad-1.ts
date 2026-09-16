// invalid-1：child_process.exec 命令非字面量
import cp from 'node:child_process'

export function run(cmd: string) {
  return cp.exec(cmd)
}
