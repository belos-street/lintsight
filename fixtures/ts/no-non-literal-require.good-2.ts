// valid-2：字面量动态 import
export async function loadConfig() {
  const cfg = await import('./config.json')
  return cfg
}
