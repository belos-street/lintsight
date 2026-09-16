// invalid-3：unlink + inputFile
import fs from 'node:fs'

export function remove(inputFile: string) {
  fs.unlink(inputFile, () => {})
}
