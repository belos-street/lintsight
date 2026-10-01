// @ts-nocheck invalid-2：constructor.prototype 链
export function reach(ctor: Record<string, any>, payload: unknown) {
  ctor['constructor']['prototype'] = payload
}
