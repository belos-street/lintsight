/**
 * RuleTester（RFC §3）：bun test 承载，一次 oxlint spawn 批扫 + 按文件断言。
 * 断言只看目标 ruleId 的诊断，内置噪音不进契约；bad 期望非空 / good 期望空由结构强制。
 */
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
      let config: string | undefined
      if (configFile) {
        const cacheDir = `${cwd}/.lintsight-cache/rules-testing`
        config = (await generateOxlintrc(cwd, configFile, cacheDir))
          .oxlintrcPath
      }
      const scan = await runOxlint(
        cases.map((c) => `${cwd}/${c.file}`),
        { cwd, config }
      )
      if (!scan.output) {
        throw new Error(
          `RuleTester: oxlint 输出不可解析（exit=${scan.exitCode}）\n${scan.stderr.slice(0, 300)}`
        )
      }
      const results: CaseResults = new Map()
      for (const d of normalizeDiagnostics(scan.output, cwd)) {
        if (d.ruleId !== ruleId) continue
        const list = results.get(d.file) ?? []
        list.push(d)
        results.set(d.file, list)
      }
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
