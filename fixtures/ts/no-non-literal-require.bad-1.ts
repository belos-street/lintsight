// @ts-nocheck invalid-1：require 参数为变量
export function loadModule(moduleName: string) {
  const mod = require(moduleName)
  return mod
}
