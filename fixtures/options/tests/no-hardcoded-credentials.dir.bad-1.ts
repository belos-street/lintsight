// @ts-nocheck tests/ 目录段内硬编码凭证 → 默认豁免（0 诊断）
// Windows 下 context.filename 为反斜杠绝对路径，isTestFile 必须同时识别 '/' 与 '\\'
export const testUser = {
  username: 'admin',
  password: 'hunter22',
  retries: 3
}
