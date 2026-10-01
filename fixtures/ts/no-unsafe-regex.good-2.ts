// @ts-nocheck valid-2：RegExp 构造器安全形态
export function buildDate() {
  return new RegExp('^\\d{4}-\\d{2}$')
}
