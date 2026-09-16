// invalid-1：runInContext 参数为变量
import vm from 'node:vm'

export function evalDynamic(code: string, ctx: vm.Context) {
  return vm.runInContext(code, ctx)
}
