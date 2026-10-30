/** 测试文件识别（M2.7 精度批次）：*.test./ *.spec. 后缀 + __tests__|tests|test 目录段。
 * 分隔符兼容 POSIX 与 Windows：oxlint JS Plugins 的 context.filename 是平台原生
 * 绝对路径（Windows 为反斜杠），只按 '/' 分段会让测试豁免在 Windows 整体失效。 */
export function isTestFile(filename) {
  if (typeof filename !== 'string') return false
  const segments = filename.toLowerCase().split(/[/\\]/)
  const basename = segments[segments.length - 1]
  if (basename.includes('.test.') || basename.includes('.spec.')) return true
  return segments.some(
    (s) => s === '__tests__' || s === 'test' || s === 'tests'
  )
}
