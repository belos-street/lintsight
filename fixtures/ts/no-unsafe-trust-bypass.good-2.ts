// @ts-nocheck safe-2：走 sanitize() 正道（净化而非信任绕过）——不触发
export function renderSafe (dirty: string) {
  const clean = this.sanitizer.sanitize(SecurityContext.HTML, dirty)
  el.innerHTML = clean
}
