// invalid-2：SHA1
import crypto from 'node:crypto'

export function sha1(input: string) {
  return crypto.createHash('sha1').update(input).digest('hex')
}
