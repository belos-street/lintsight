// @ts-nocheck invalid-3：动态 import 非字面量
export async function importView(specifier: string) {
  const m = await import(specifier)
  return m
}
