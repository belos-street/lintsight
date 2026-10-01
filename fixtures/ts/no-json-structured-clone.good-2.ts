// @ts-nocheck valid-2：结构化克隆用内建 API
export function cloneState(state: unknown) {
  return structuredClone(state)
}
