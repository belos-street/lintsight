// invalid-3：require(...).execSync 链式调用
export function run3(userInput: string) {
  return require('child_process').execSync(userInput)
}
