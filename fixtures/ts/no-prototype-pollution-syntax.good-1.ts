// @ts-nocheck valid-1：普通成员赋值不触发
export function assign(obj: { profile?: unknown }, data: unknown) {
  obj.profile = data
}
