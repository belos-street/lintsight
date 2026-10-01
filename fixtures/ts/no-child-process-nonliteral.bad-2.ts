// @ts-nocheck invalid-2：解构 exec + 模板拼接命令
const { exec } = require('child_process')

export function run2(userInput: string) {
  return exec(`ls ${userInput}`)
}
