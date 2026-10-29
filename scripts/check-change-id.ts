#!/usr/bin/env bun
/**
 * spec-first 机器校验（最小实现）
 *
 * 触发：本次提交的代码文件 >= 3（排除文档/AI 资产/测试/锁文件等），
 * 且提交信息不含 change-id（change/YYYYMMDD-主题 或 change-id: ...）→ 拦截。
 *
 * 用法：bun run check:change-id -- <commit-msg-file>
 * 逃生舱：确认简单后可用 git commit --no-verify（知情选择，非默认路径）。
 */
import { readFileSync } from 'node:fs'

const args = process.argv.slice(2).filter((a) => a !== '--')
const msgFile = args[0]
if (!msgFile) {
  console.error('usage: bun run check:change-id -- <commit-msg-file>')
  process.exit(0)
}

let message = ''
try {
  message = readFileSync(msgFile, 'utf8')
} catch (e) {
  console.error(`[spec-first] 读取提交信息失败，跳过校验：${String(e)}`)
  process.exit(0)
}

if (/^merge |^revert /i.test(message)) process.exit(0)
if (/change(?:[-_ ]?id)?[\s:=/-]*\d{8}-[a-z0-9-]+/i.test(message))
  process.exit(0)

const diff = Bun.spawnSync(
  ['git', 'diff', '--cached', '--name-only', '--diff-filter=ACM'],
  { cwd: process.cwd() }
)
if (diff.exitCode !== 0) {
  console.error('[spec-first] git diff 失败，跳过校验')
  process.exit(0)
}

const files = diff.stdout
  .toString()
  .split(/\r?\n/)
  .map((s) => s.trim())
  .filter(Boolean)

const EXCLUDE = [
  /^docs\//,
  /^\.agents\//,
  /^\.github\//,
  /\.md$/,
  /^(bun\.lock|Cargo\.lock|package\.json)$/,
  /^(tsconfig\.json|lintsight\.config\.json|\.oxlintrc\.json)$/,
  /\.test\.[jt]s$/,
  /\.spec\.[jt]s$/,
  /^plugins\/lintsight-rules\/index\.js$/
]
const effective = files.filter((f) => !EXCLUDE.some((re) => re.test(f)))

if (effective.length >= 3) {
  console.error(
    `\n[spec-first 闸门] 本次提交改动 ${effective.length} 个代码文件（已排除文档/AI 资产/测试）：`
  )
  console.error(
    '  复杂变更须先在 docs/changes/<change-id>/ 产出 proposal/design/tasks 三层文档并等确认。'
  )
  console.error(
    '  提交信息需含 change-id，例如：feat(scope): xxx (change/20261029-xxx)'
  )
  console.error(
    '  若确属简单改动，请核对改动范围；确需跳过请在知情后使用 git commit --no-verify。'
  )
  process.exit(1)
}
