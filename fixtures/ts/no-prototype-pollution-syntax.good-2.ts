// valid-2：Object.assign 合并面属于 M2 taint（语法层不误伤常规写法）
export function merge(target: Record<string, unknown>, defaults: Record<string, unknown>, overrides: Record<string, unknown>) {
  return Object.assign({}, defaults, overrides, target)
}
