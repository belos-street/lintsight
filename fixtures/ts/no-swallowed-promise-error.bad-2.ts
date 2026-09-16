// invalid-2：吞错直接返回默认值
export function load2(raw: string) {
  try {
    return JSON.parse(raw)
  } catch (err) {
    return null
  }
}
