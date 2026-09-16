// valid-2：rethrow / 包装抛出都算处理
export function parse(raw: string) {
  try {
    return JSON.parse(raw)
  } catch (e) {
    throw new Error(`bad json: ${String(e)}`)
  }
}

export function rethrow(raw: string) {
  try {
    return JSON.parse(raw)
  } catch (e) {
    throw e
  }
}
