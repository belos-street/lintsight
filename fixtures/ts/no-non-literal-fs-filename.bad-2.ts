// @ts-nocheck invalid-2：readFileSync + userPath
import fs from 'node:fs'

export function loadSync(userPath: string) {
  return fs.readFileSync(userPath, 'utf8')
}
