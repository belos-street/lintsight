// @ts-nocheck invalid-1：catch 空箭头回调
export function load(url: string) {
  return fetch(url).catch(() => {})
}
