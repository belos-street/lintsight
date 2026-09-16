// valid-1：SHA256 属于当前安全基线
import crypto from 'node:crypto'

export function sha256(input: string) {
  return crypto.createHash('sha256').update(input).digest('hex')
}
