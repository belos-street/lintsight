// @ts-nocheck G12 preset：1b 内置规则（new Function / document.cookie / switch fallthrough）
export function run(code: string) {
  new Function('return ' + code)
  document.cookie = 'sid=' + code
}

export function pick(n: number) {
  let out = ''
  switch (n) {
    case 1:
      out += 'a'
    case 2:
      out += 'b'
  }
  return out
}
