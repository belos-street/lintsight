// valid-2：其他 vm API 不在检测面
import vm from 'node:vm'

export function compile(body: string) {
  return new vm.Script('1 + 1')
}
