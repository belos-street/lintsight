/**
 * 最小 JSONC 预处理：剥离注释（// 与 /* *\/）与尾随逗号，输出可 JSON.parse 的文本。
 * 状态机实现——字符串内的注释符号、转义引号不误伤。
 */

export function stripJsonComments(input: string): string {
  let out = ''
  let i = 0
  let state: 'code' | 'string' = 'code'
  while (i < input.length) {
    const ch = input[i]
    const next = input[i + 1]

    if (state === 'string') {
      out += ch
      if (ch === '\\') {
        out += next ?? ''
        i += 2
        continue
      }
      if (ch === '"') state = 'code'
      i++
      continue
    }

    if (ch === '"') {
      state = 'string'
      out += ch
      i++
      continue
    }
    if (ch === '/' && next === '/') {
      while (i < input.length && input[i] !== '\n') i++
      continue
    }
    if (ch === '/' && next === '*') {
      i += 2
      while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) i++
      i += 2
      continue
    }
    out += ch
    i++
  }
  return out
}

/** 去掉对象/数组字面量中尾随逗号（仅 code 位置，字符串不处理——先过 stripJsonComments） */
export function stripTrailingCommas(input: string): string {
  let out = ''
  let i = 0
  let state: 'code' | 'string' = 'code'
  while (i < input.length) {
    const ch = input[i]
    if (state === 'string') {
      out += ch
      if (ch === '\\') {
        out += input[i + 1] ?? ''
        i += 2
        continue
      }
      if (ch === '"') state = 'code'
      i++
      continue
    }
    if (ch === '"') {
      state = 'string'
      out += ch
      i++
      continue
    }
    if (ch === ',') {
      // 向前看：跳过空白与换行，若下一个有效字符是 } 或 ] 则丢弃此逗号
      let j = i + 1
      while (j < input.length && /\s/.test(input[j])) j++
      if (input[j] === '}' || input[j] === ']') {
        i++
        continue
      }
    }
    out += ch
    i++
  }
  return out
}

export function parseJsonc(text: string): unknown {
  return JSON.parse(stripTrailingCommas(stripJsonComments(text)))
}
