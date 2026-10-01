// @ts-nocheck valid-1：单层量词 + 锚定的安全正则
export function checkVersion(input: string) {
  return /^[a-z]+\d{4}-\d{2}$/.test(input)
}
