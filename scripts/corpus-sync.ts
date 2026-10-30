/**
 * T1.18 语料库同步：按 corpus/corpus.json 锁定版本浅克隆到 corpus/repos/<name>。
 * 语料本体不入库（gitignore），锁定靠 tag + 克隆后 commit 校验。
 *
 * 行尾锁定 LF：指纹/offset 是基线 diff 的最小单元，Windows 全局 core.autocrlf=true
 * 会把无 .gitattributes 的仓库检出成 CRLF，导致同一 tag 的 offset 与 Linux 基线漂移。
 */
import { mkdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = fileURLToPath(new URL('../', import.meta.url))
export const REPOS_DIR = path.join(ROOT, 'corpus', 'repos')

export interface CorpusRepo {
  name: string
  repo: string
  tag: string
  note?: string
}

export interface CorpusManifest {
  version: number
  description?: string
  repos: CorpusRepo[]
}

export async function readManifest(): Promise<CorpusManifest> {
  const raw = await readFile(path.join(ROOT, 'corpus', 'corpus.json'), 'utf8')
  const manifest = JSON.parse(raw) as CorpusManifest
  if (!Array.isArray(manifest.repos) || manifest.repos.length === 0) {
    throw new Error('corpus.json: repos 不能为空')
  }
  return manifest
}

async function git(args: string[], cwd?: string): Promise<string> {
  const proc = Bun.spawn(['git', ...args], {
    cwd: cwd ?? ROOT,
    stdout: 'pipe',
    stderr: 'pipe'
  })
  const out = await new Response(proc.stdout).text()
  const code = await proc.exited
  if (code !== 0) {
    const err = await new Response(proc.stderr).text()
    throw new Error(`git ${args.join(' ')} 失败: ${err.slice(0, 300)}`)
  }
  return out.trim()
}

/** 已克隆仓库是否为 LF 检出（clone 成功后写入 .git/lintsight-lf 标记）。
 * 无标记（历史克隆可能是 CRLF）或标记丢失时直接重建：checkout-index 对无
 * attributes 的文件不可靠，且 corpus/repos 是可丢弃缓存（不入库）。 */
async function isLfCheckout(dest: string): Promise<boolean> {
  return Bun.file(path.join(dest, '.git', 'lintsight-lf')).exists()
}

/** 同步单个语料库：已存在则校验 tag 一致，缺失/非 LF 则浅克隆 */
export async function syncRepo(
  r: CorpusRepo
): Promise<{ status: 'cloned' | 'recloned' | 'ok' }> {
  const dest = path.join(REPOS_DIR, r.name)
  await mkdir(REPOS_DIR, { recursive: true })

  const existing = await Bun.file(path.join(dest, '.git', 'HEAD')).exists()
  let recloned = false
  if (existing) {
    // 已克隆：校验 HEAD 是否在锁定 tag 上（与 manifest 对账，防漂移）
    const commit = await git(['rev-parse', 'HEAD'], dest)
    const tagCommit = await git(['rev-parse', `${r.tag}^{commit}`], dest)
    if (commit !== tagCommit) {
      throw new Error(
        `corpus/${r.name}: HEAD 与锁定 tag ${r.tag} 不一致，删除 corpus/repos/${r.name} 后重跑`
      )
    }
    if (await isLfCheckout(dest)) return { status: 'ok' }
    console.log(`corpus: ${r.name} 非 LF 检出（指纹不可跨平台复现），重建 …`)
    await rm(dest, { recursive: true, force: true })
    recloned = true
  } else {
    console.log(`corpus: cloning ${r.name}@${r.tag} …`)
  }

  await git(
    [
      '-c',
      'core.autocrlf=false',
      '-c',
      'core.eol=lf',
      'clone',
      '--depth',
      '1',
      '--branch',
      r.tag,
      r.repo,
      r.name
    ],
    REPOS_DIR
  )
  // 标记本次检出为 LF 锁定（下次同步据此跳过重建）
  await Bun.write(path.join(dest, '.git', 'lintsight-lf'), '1\n')
  return { status: recloned ? 'recloned' : 'cloned' }
}

export async function syncAll(): Promise<void> {
  const manifest = await readManifest()
  const results = await Promise.all(
    manifest.repos.map(async (r) => ({
      r,
      ...(await syncRepo(r))
    }))
  )
  for (const { r, status } of results) {
    console.log(`corpus: ${r.name}@${r.tag} ${status}`)
  }
}

if (import.meta.main) await syncAll()
