// @ts-nocheck invalid-3：方法引用形态（不是直接调用表达式的常见写法）——脚本信任
export function bindScript (payload: string) {
  const trusted = sanitizer.bypassSecurityTrustScript(payload)
  host.trustedScript = trusted
}
