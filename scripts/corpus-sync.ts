/**
 * T1.18 语料库同步：按 corpus/corpus.json 锁定版本浅克隆到 corpus/repos/<name>。
 * 语料本体不入库（gitignore），锁定靠 tag + 克隆后 commit 校验。
 */
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

export const ROOT = new URL('../', import.meta.url).pathname
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

/** 同步单个语料库：已存在则校验 tag 一致，缺失则浅克隆 */
export async function syncRepo(r: CorpusRepo): Promise<{ updated: boolean }> {
  const dest = path.join(REPOS_DIR, r.name)
  await mkdir(REPOS_DIR, { recursive: true })

  const existing = await Bun.file(path.join(dest, '.git', 'HEAD')).exists()
  if (existing) {
    // 已克隆：校验 HEAD 是否在锁定 tag 上（与 manifest 对账，防漂移）
    const commit = await git(['rev-parse', 'HEAD'], dest)
    const tagCommit = await git(['rev-parse', `${r.tag}^{commit}`], dest)
    if (commit !== tagCommit) {
      throw new Error(
        `corpus/${r.name}: HEAD 与锁定 tag ${r.tag} 不一致，删除 corpus/repos/${r.name} 后重跑`
      )
    }
    return { updated: false }
  }

  console.log(`corpus: cloning ${r.name}@${r.tag} …`)
  await git(
    ['clone', '--depth', '1', '--branch', r.tag, r.repo, r.name],
    REPOS_DIR
  )
  return { updated: true }
}

export async function syncAll(): Promise<void> {
  const manifest = await readManifest()
  const results = await Promise.all(
    manifest.repos.map(async (r) => ({
      r,
      ...(await syncRepo(r))
    }))
  )
  for (const { r, updated } of results) {
    console.log(`corpus: ${r.name}@${r.tag} ${updated ? 'cloned' : 'ok'}`)
  }
}

if (import.meta.main) await syncAll()
