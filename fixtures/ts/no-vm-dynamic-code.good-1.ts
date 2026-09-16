// valid-1：字面量脚本（静态）
import vm from 'node:vm'

export function sanity(ctx: vm.Context) {
  return vm.runInContext('1 + 1', ctx)
}
