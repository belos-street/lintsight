// valid-1：catch 有实际处理
export function load4(url: string) {
  return fetch(url).catch((e) => {
    console.error('load failed', e)
    return null
  })
}
