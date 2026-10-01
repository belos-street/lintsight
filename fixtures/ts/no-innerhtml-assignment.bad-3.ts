// @ts-nocheck invalid-3：document.write 右值为变量
export function legacyWrite(userContent: string) {
  document.write(userContent)
}
