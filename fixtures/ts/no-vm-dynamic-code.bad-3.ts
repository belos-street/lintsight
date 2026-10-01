// @ts-nocheck invalid-3：runInThisContext 动态脚本
import vm from 'node:vm'

export function boot(dynamicScript: string) {
  return vm.runInThisContext(dynamicScript)
}
