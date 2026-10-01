// @ts-nocheck invalid-3：大小写变体
import crypto from 'node:crypto'

export function md5Upper(input: string) {
  return crypto.createHash('MD5').update(input).digest('hex')
}
