// @ts-nocheck invalid-1：嵌套量词（(a+)+）—— 回溯爆炸经典形态
export function check(input: string) {
  return /(a+)+$/.test(input)
}
