// @ts-nocheck invalid-1：JSON.parse(JSON.stringify(x)) —— Date/Map/undefined 会被静默丢弃
export function cloneConfig(cfg: unknown) {
  return JSON.parse(JSON.stringify(cfg))
}
