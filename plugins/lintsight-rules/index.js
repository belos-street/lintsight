/**
 * lintsight 自有规则集（JS 轨道，oxlint JS Plugins · alpha）。
 * 运行在 oxlint 嵌入式 JS runtime —— 本文件禁止使用 Bun/Node API；
 * meta 契约由 @lintsight/rule-sdk 的 definePlugin 在测试期校验（RFC 开放问题 5：bundle 方案 M1.5）。
 */
export default {
  name: 'lintsight',
  meta: { name: 'lintsight' },
  rules: {
    'no-empty-catch': {
      meta: {
        // —— FR-203 meta 完备性契约 ——
        category: 'correctness',
        severity: 'error',
        confidence: 'high',
        typeRequirement: 'none',
        tags: [],
        fixable: undefined,
        messages: {
          emptyCatch:
            'Unexpected empty catch block. Handle the error or rethrow it.'
        },
        docs: {
          description: '禁止空的 catch 块',
          rationale:
            '空 catch 会静默吞掉错误，掩盖线上故障的根因；应处理、记录或重新抛出。',
          badExamples: ['try { risky(); } catch (e) {}'],
          goodExamples: [
            'try { risky(); } catch (e) { logger.error(e); throw e; }'
          ],
          falsePositives: [
            '注释占位的 catch 也会告警（零语句即触发）——正式版可增加 allowComments 选项'
          ]
        }
      },
      create(context) {
        return {
          CatchClause(node) {
            const statements = node.body?.body ?? []
            if (statements.length === 0) {
              context.report({ node, messageId: 'emptyCatch' })
            }
          }
        }
      }
    },

    'no-async-array-method': {
      meta: {
        category: 'correctness',
        severity: 'error',
        confidence: 'high',
        typeRequirement: 'none',
        tags: [],
        fixable: undefined,
        messages: {
          asyncArrayMethod:
            'Array.prototype.{{method}} does not await async callbacks: the returned Promise is ignored. Use for...of with await, or Promise.all. (no-async-array-method)'
        },
        docs: {
          description:
            '禁止向 forEach/map/filter/reduce 等数组方法传入 async 回调',
          rationale:
            '数组方法不感知 Promise，async 回调返回的 Promise 被静默丢弃：forEach 的异常不会冒泡、map 的结果不是数据而是 Promise 数组、reduce 的聚合值是 Promise。',
          badExamples: ['ids.forEach(async (id) => { await save(id) })'],
          goodExamples: [
            'for (const id of ids) { await save(id) }',
            'await Promise.all(ids.map((id) => save(id)))'
          ],
          falsePositives: [
            '自定义类实现同名方法且确有 Promise 语义时误报（duck typing 限制，可行内 ignore）'
          ]
        }
      },
      create(context) {
        const METHODS = new Set([
          'forEach',
          'map',
          'filter',
          'reduce',
          'reduceRight',
          'some',
          'every'
        ])
        return {
          CallExpression(node) {
            const callee = node.callee
            if (!callee || callee.type !== 'MemberExpression') return
            if (!callee.property || callee.property.type !== 'Identifier')
              return
            const method = callee.property.name
            if (!METHODS.has(method)) return
            const cb = node.arguments?.[0]
            if (!cb) return
            if (
              (cb.type === 'ArrowFunctionExpression' ||
                cb.type === 'FunctionExpression') &&
              cb.async
            ) {
              context.report({
                node,
                messageId: 'asyncArrayMethod',
                data: { method }
              })
            }
          }
        }
      }
    }
  }
}
