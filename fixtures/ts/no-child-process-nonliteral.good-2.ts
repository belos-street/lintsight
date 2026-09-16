// valid-2：execSync 字面量命令
export function gitStatus() {
  return require('child_process').execSync('git status --short')
}
