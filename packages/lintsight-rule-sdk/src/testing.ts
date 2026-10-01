/**
 * RuleTester（RFC §3）：bun test 承载，一次 oxlint spawn 批扫 + 按文件断言。
 * 断言只看目标 ruleId 的诊断，内置噪音不进契约；bad 期望非空 / good 期望空由结构强制。
 * 规则选项（T1.13）：case 带 options 时按选项分组叠加生成独立 oxlintrc
 * （config-bridge 选项数组语义，T1.8 实测有效），每组一次 spawn。
 */
import { readFile } from 'node:fs/promises'
import { runOxlint } from '@lintsight/cli/oxlint-bridge'
import { generateOxlintrc, resolveConfigFile } from '@lintsight/config-bridge'
import {
  normalizeDiagnostics,
  type NormalizedDiagnostic
} from '@lintsight/diagnostic'

export interface RuleCase {
  /** 相对项目根的 fixture 路径 */
  file: string
  /** 期望诊断位置（1-based）；valid 用例传 [] */
  expect: { line: number; column: number }[]
  /** 规则选项对象（如 { allowComments: true }）；缺省 = 产品默认配置 */
  options?: Record<string, unknown>
}

export type CaseResults = Map<string, NormalizedDiagnostic[]>

export interface RuleTester {
  run(cases: RuleCase[], opts?: { cwd?: string }): Promise<CaseResults>
  expect(results: CaseResults, c: RuleCase): void
}

export function defineRuleTester(opts: { ruleId: string }): RuleTester {
  const { ruleId } = opts
  const projectRoot = new URL('../../../', import.meta.url).pathname

  return {
    async run(cases, runOpts = {}): Promise<CaseResults> {
      const cwd = runOpts.cwd ?? projectRoot
      // 与 pipeline 同款配置链路（dogfood）：lintsight.config.json → 生成 .oxlintrc → --config 显式传入，
      // 避免与根 dev 配置（.oxlintrc.json）漂移——规则契约必须按产品配置验收
      const configFile = resolveConfigFile(cwd)
      let baseOxlintrc: string | undefined
      const cacheDir = `${cwd}/.lintsight-cache/rules-testing`
      if (configFile) {
        baseOxlintrc = (await generateOxlintrc(cwd, configFile, cacheDir))
          .oxlintrcPath
      }

      // 按规则选项分组：同选项共享一次 spawn；无选项组走产品默认配置
      const groups = new Map<string, RuleCase[]>()
      for (const c of cases) {
        const key = JSON.stringify(c.options ?? null)
        const g = groups.get(key)
        if (g) g.push(c)
        else groups.set(key, [c])
      }

      const results: CaseResults = new Map()
      await Promise.all(
        [...groups.entries()].map(async ([key, groupCases]) => {
          let config = baseOxlintrc
          if (key !== 'null' && baseOxlintrc) {
            // 叠加规则选项：rules[ruleId] = ['error', options]（T1.8 实测语义）
            const raw = JSON.parse(await readFile(baseOxlintrc, 'utf8')) as {
              rules?: Record<string, unknown>
            }
            raw.rules = raw.rules ?? {}
            raw.rules[ruleId] = [
              'error',
              JSON.parse(key) as Record<string, unknown>
            ]
            const groupConfig = `${cacheDir}/options-${key.replace(/[^\w]/g, '_')}.json`
            await Bun.write(groupConfig, JSON.stringify(raw, null, 2))
            config = groupConfig
          }
          const scan = await runOxlint(
            groupCases.map((c) => `${cwd}/${c.file}`),
            { cwd, config }
          )
          if (!scan.output) {
            throw new Error(
              `RuleTester: oxlint 输出不可解析（exit=${scan.exitCode}）\n${scan.stderr.slice(0, 300)}`
            )
          }
          for (const d of normalizeDiagnostics(scan.output, cwd)) {
            if (d.ruleId !== ruleId) continue
            const list = results.get(d.file) ?? []
            list.push(d)
            results.set(d.file, list)
          }
        })
      )
      return results
    },

    expect(results, c): void {
      const diags = results.get(c.file) ?? []
      if (c.expect.length === 0) {
        if (diags.length !== 0) {
          throw new Error(
            `[${ruleId}] ${c.file}: 期望 0 条诊断，实际 ${diags.length} 条（safe case 回归）：\n` +
              diags
                .map((d) => `  ${d.span.line}:${d.span.column} ${d.message}`)
                .join('\n')
          )
        }
        return
      }
      if (diags.length !== c.expect.length) {
        throw new Error(
          `[${ruleId}] ${c.file}: 期望 ${c.expect.length} 条诊断，实际 ${diags.length} 条\n` +
            diags
              .map((d) => `  ${d.span.line}:${d.span.column} ${d.message}`)
              .join('\n')
        )
      }
      for (const [i, pos] of c.expect.entries()) {
        if (
          diags[i].span.line !== pos.line ||
          diags[i].span.column !== pos.column
        ) {
          throw new Error(
            `[${ruleId}] ${c.file}: 诊断 #${i + 1} 位置期望 ${pos.line}:${pos.column}，实际 ${diags[i].span.line}:${diags[i].span.column}`
          )
        }
      }
      for (const d of diags) {
        if (!d.ruleId.startsWith('lintsight/')) {
          throw new Error(
            `[${ruleId}] ${c.file}: ruleId 命名空间契约违规：${d.ruleId}`
          )
        }
        if (d.severity !== 'error' && d.severity !== 'warning') {
          throw new Error(`[${ruleId}] ${c.file}: severity 非法：${d.severity}`)
        }
      }
    }
  }
}
