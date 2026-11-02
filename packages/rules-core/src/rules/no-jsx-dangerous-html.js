/**
 * no-jsx-dangerous-html —— P0 安全（G9，CWE-79 / OWASP A03）。
 * JSX `dangerouslySetInnerHTML` 是显式 HTML 注入面；静态无法证明 value 已清洗，
 * 统一 medium confidence 报属性本身。
 */
export default {
  meta: {
    category: 'security',
    severity: 'error',
    confidence: 'medium',
    typeRequirement: 'none',
    tags: ['cwe-79', 'owasp-a03'],
    fixable: undefined,
    schema: [],
    messages: {
      dangerousHtml:
        'Avoid dangerouslySetInnerHTML; sanitize the HTML or use safe DOM APIs. (no-jsx-dangerous-html)'
    },
    docs: {
      description: '禁止 JSX dangerouslySetInnerHTML（XSS sink）',
      rationale:
        'dangerouslySetInnerHTML 直接把字符串当 HTML 插入 DOM，未清洗/清洗不彻底即成 XSS；应使用安全的 DOM/组件 API 或经过可信净化。',
      badExamples: [
        '<div dangerouslySetInnerHTML={{ __html: userInput }} />',
        '<Component dangerouslySetInnerHTML={{ __html: html }} />'
      ],
      goodExamples: [
        '<div>{userInput}</div>',
        '<SafeHtml value={sanitize(userInput)} />'
      ],
      falsePositives: [
        '即使 value 是 DOMPurify.sanitize(...) 也会报告（medium confidence 的保守选择；可用行内 ignore）',
        '组件名/元素类型不影响判定：任何 JSX 元素上的该 prop 都报',
        'Vue v-html 归 G8 的 lintsight/no-v-html，不在本规则面'
      ]
    }
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        for (const attr of node.attributes ?? []) {
          if (attr?.type !== 'JSXAttribute') continue
          if (
            attr.name?.type === 'JSXIdentifier' &&
            attr.name.name === 'dangerouslySetInnerHTML'
          ) {
            context.report({ node: attr, messageId: 'dangerousHtml' })
          }
        }
      }
    }
  }
}
