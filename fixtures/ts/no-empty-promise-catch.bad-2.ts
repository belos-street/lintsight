// invalid-2：catch(() => undefined)
export function load2(url: string) {
  return fetch(url).catch(() => undefined)
}
