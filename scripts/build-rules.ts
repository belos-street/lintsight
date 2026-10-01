/**
 * 规则集构建：packages/rules-core/src（每规则一文件）→ bun build 聚合为自包含单文件产物。
 * 产物 plugins/lintsight-rules/index.js 提交 git，被 oxlint 嵌入式 runtime 直接加载——
 * 该 runtime 不支持相对 import（实测硬约束），故产物必须自包含（无 import 语句）。
 */
export {}

const entry = 'packages/rules-core/src/index.js'
const out = 'plugins/lintsight-rules/index.js'

await Bun.$`bun build ${entry} --outfile ${out} --target=browser --format=esm`.quiet()
// 产物也过 oxfmt（format 脚本覆盖 plugins/）——否则 test 重建（bun build 默认双引号）
// 与 format（单引号）来回翻转，git 每次必漂移
await Bun.$`bunx oxfmt ${out}`.quiet()

const text = await Bun.file(out).text()
if (/^\s*import\s/m.test(text)) {
  throw new Error('构建产物含 import 语句——oxlint 嵌入式 runtime 不支持（硬约束），聚合失败')
}
console.log(`rules bundled → ${out} (${text.length} bytes, ${(text.match(/\n/g) ?? []).length + 1} lines)`)
