#!/usr/bin/env bun
/**
 * spec-first 机器校验：
 *   - 默认（本地 hook）：读 commit-msg 文件 + staged diff；
 *   - `--range <base..head>`（G3 CI）：逐提交检查 message + 该提交的代码文件数。
 *
 * 触发：单个提交的代码文件 >= 3（排除文档/AI 资产/测试/锁文件等），
 * 且提交信息不含 change-id（change/YYYYMMDD-主题 或 change-id: ...）→ 拦截。
 *
 * 用法：bun run check:change-id -- <commit-msg-file>
 *       bun run check:change-id:ci -- origin/main...HEAD
 */
import { readFileSync } from 'node:fs'

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

export function isExemptMessage(message: string): boolean {
  return /^merge |^revert /i.test(message)
}

export function hasChangeId(message: string): boolean {
  return /change(?:[-_ ]?id)?[\s:=/-]*\d{8}-[a-z0-9-]+/i.test(message)
}

export function effectiveCodeFiles(files: string[]): string[] {
  return files.filter((f) => f && !EXCLUDE.some((re) => re.test(f)))
}

/** 单提交是否需要 change-id（纯函数，供本地 hook 与 CI range 共用） */
export function needsChangeId(
  message: string,
  files: string[]
): { required: boolean; effective: string[] } {
  const effective = effectiveCodeFiles(files)
  return {
    required:
      !isExemptMessage(message) && !hasChangeId(message) && effective.length >= 3,
    effective
  }
}

function git(args: string[]): { code: number; out: string } {
  const r = Bun.spawnSync(['git', ...args], { cwd: process.cwd() })
  return { code: r.exitCode ?? 1, out: r.stdout.toString() }
}

function filesFromOutput(out: string): string[] {
  return out
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function reportCommit(label: string, effective: string[]): void {
  console.error(
    `\n[spec-first 闸门] ${label} 改动 ${effective.length} 个代码文件（已排除文档/AI 资产/测试）：`
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
}

/** 本地 hook：commit-msg 文件 + staged diff */
function runStaged(msgFile: string | undefined): number {
  if (!msgFile) {
    console.error('usage: bun run check:change-id -- <commit-msg-file>')
    return 0
  }

  let message = ''
  try {
    message = readFileSync(msgFile, 'utf8')
  } catch (e) {
    console.error(`[spec-first] 读取提交信息失败，跳过校验：${String(e)}`)
    return 0
  }

  const diff = git(['diff', '--cached', '--name-only', '--diff-filter=ACM'])
  if (diff.code !== 0) {
    console.error('[spec-first] git diff 失败，跳过校验')
    return 0
  }

  const result = needsChangeId(message, filesFromOutput(diff.out))
  if (result.required) {
    reportCommit('本次提交', result.effective)
    return 1
  }
  return 0
}

/** CI：逐提交检查范围（base..head） */
function runRange(range: string): number {
  const list = git(['rev-list', '--reverse', range])
  if (list.code !== 0) {
    console.error(`[spec-first] git rev-list 失败：${range}`)
    return 2
  }

  let failed = false
  for (const sha of filesFromOutput(list.out)) {
    const msg = git(['log', '-1', '--format=%B', sha])
    const shown = git([
      'show',
      '--name-only',
      '--format=',
      '--diff-filter=ACM',
      sha
    ])
    if (msg.code !== 0 || shown.code !== 0) {
      console.error(`[spec-first] 读取提交 ${sha} 失败，跳过该提交`)
      continue
    }
    const result = needsChangeId(msg.out, filesFromOutput(shown.out))
    if (result.required) {
      reportCommit(`commit ${sha.slice(0, 8)}`, result.effective)
      failed = true
    }
  }
  return failed ? 1 : 0
}

function main(): void {
  const args = process.argv.slice(2).filter((a) => a !== '--')
  const rangeIdx = args.indexOf('--range')
  if (rangeIdx >= 0) {
    const range = args[rangeIdx + 1]
    if (!range) {
      console.error('usage: bun run check:change-id:ci -- <base..head>')
      process.exit(2)
    }
    process.exit(runRange(range))
  }
  process.exit(runStaged(args[0]))
}

if (import.meta.main) main()
