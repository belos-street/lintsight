// @ts-nocheck invalid-1：计算键 '__proto__' 赋值
export function inject(obj: Record<string, unknown>, payload: unknown) {
  obj['__proto__'] = payload
}
