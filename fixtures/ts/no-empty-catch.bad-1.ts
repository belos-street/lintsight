// @ts-nocheck invalid-1：基础空 catch（可选 catch binding，无参数）
export function loadConfig(path: string): unknown {
  try {
    return JSON.parse(path);
  } catch {
  }
}
