// @ts-nocheck valid-2：算法为变量时保守不报
import crypto from 'node:crypto'

export function byName(algo: string, input: string) {
  return crypto.createHash(algo).update(input).digest('hex')
}
