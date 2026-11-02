/**
 * no-unsafe-jsx-url —— P0 安全（G9，CWE-79 / OWASP A03）。
 * 判定矩阵：
 * - 任意 JSX href/src 字面量 trim+lowercase 后以 javascript: 开头 → 报；
 * - href 字面量以 data: 开头 → 报；src 仅放行 data:image/png|jpeg|gif|webp；
 * - <a>/<area>/<link> 的 href、<iframe>/<script> 的 src 动态表达式 → 报（warning/medium）；
 * - 模板串首段锚定 /、#、? → 放行；img 动态 src、spread、自定义组件动态值不分析。
 */
const HREF_ELEMENTS = new Set(['a', 'area', 'link'])
const SRC_ELEMENTS = new Set(['iframe', 'script'])
const SAFE_IMAGE_DATA = /^data:image\/(png|jpeg|gif|webp)(;|,)/

function normalizeString(value) {
  return value.trim().toLowerCase()
}

function isDangerousScheme(value, attrName) {
  if (typeof value !== 'string') return false
  const normalized = normalizeString(value)
  if (normalized.startsWith('javascript:')) return true
  if (normalized.startsWith('data:')) {
    // src 的常见安全图片 MIME 放行；SVG/其他 MIME 仍报
    if (attrName === 'src' && SAFE_IMAGE_DATA.test(normalized)) return false
    return true
  }
  return false
}

/** 从 JSXAttribute.value 取静态字符串；动态/非字符串返回 null。
 * 无插值模板取 cooked（转义后真实字符串），否则 `\u006aavascript:` 会漏报。 */
function staticString(attr) {
  if (attr.value?.type === 'Literal' && typeof attr.value.value === 'string') {
    return attr.value.value
  }
  if (attr.value?.type === 'JSXExpressionContainer') {
    const expr = attr.value.expression
    if (expr?.type === 'Literal' && typeof expr.value === 'string') {
      return expr.value
    }
    if (
      expr?.type === 'TemplateLiteral' &&
      (!expr.expressions || expr.expressions.length === 0)
    ) {
      return (
        expr.quasis?.[0]?.value?.cooked ?? expr.quasis?.[0]?.value?.raw ?? null
      )
    }
  }
  return null
}

/** 表达式的静态前缀：Literal / 模板首段 cooked / 二元拼接任一侧静态面 */
function staticPrefix(node) {
  if (!node) return null
  if (node.type === 'Literal' && typeof node.value === 'string') {
    return node.value
  }
  if (node.type === 'TemplateLiteral') {
    return (
      node.quasis?.[0]?.value?.cooked ?? node.quasis?.[0]?.value?.raw ?? null
    )
  }
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    return staticPrefix(node.left) ?? staticPrefix(node.right)
  }
  return null
}

/** 动态 URL 的用户可控命名启发式（G9 精度边界）：
 * 只有名称像外部输入/位置来源的表达式才报，避免 href={route}/href={config.url}
 * 等路由/配置值造成 corpus 大面积误报。literal javascript:/data: 不受此限。 */
const SUSPECT_NAME =
  /(user[_-]?input|input|query|search|hash|location|redirect|return[_-]?url|callback[_-]?url|url[_-]?param|params?)/i

const SKIP_KEYS = new Set([
  'parent',
  'range',
  'loc',
  'start',
  'end',
  'typeAnnotation',
  'typeParameters',
  'typeArguments',
  'returnType',
  'superTypeParameters',
  'implements',
  'decorators'
])

function hasSuspectName(node) {
  if (!node || typeof node !== 'object') return false
  if (Array.isArray(node)) return node.some(hasSuspectName)
  if (node.type === 'Identifier' && SUSPECT_NAME.test(node.name)) return true
  if (
    node.type === 'MemberExpression' &&
    node.property?.type === 'Identifier' &&
    SUSPECT_NAME.test(node.property.name)
  ) {
    return true
  }
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue
    if (hasSuspectName(node[key])) return true
  }
  return false
}

/** 动态表达式是否危险：静态危险 scheme（模板/二元拼接）优先于名称启发与锚定放行 */
function isDynamicUnsafe(expr, attrName) {
  if (!expr) return false
  if (expr.type === 'Literal') return false
  if (expr.type === 'TemplateLiteral') {
    const first =
      expr.quasis?.[0]?.value?.cooked ?? expr.quasis?.[0]?.value?.raw ?? ''
    if (isDangerousScheme(first, attrName)) return true
    if (!expr.expressions || expr.expressions.length === 0) return false
    if (/^[/#?]/.test(first)) return false
    return hasSuspectName(expr)
  }
  if (expr.type === 'BinaryExpression') {
    if (
      isDangerousScheme(staticPrefix(expr.left), attrName) ||
      isDangerousScheme(staticPrefix(expr.right), attrName)
    ) {
      return true
    }
    return hasSuspectName(expr)
  }
  return hasSuspectName(expr)
}

export default {
  meta: {
    category: 'security',
    severity: 'warning',
    confidence: 'medium',
    typeRequirement: 'none',
    tags: ['cwe-79', 'owasp-a03'],
    fixable: undefined,
    schema: [],
    messages: {
      unsafeUrl:
        'Unsafe URL in JSX attribute "{{name}}": javascript:/data: or a dynamic value may enable XSS. (no-unsafe-jsx-url)'
    },
    docs: {
      description:
        '禁止 JSX 中的 javascript:/data: URL 与高风险元素上的动态 href/src',
      rationale:
        'javascript:/data: URL 与外部可控的动态 URL 可被用于 XSS/开放重定向；应在渲染前做协议白名单与 URL 校验。',
      badExamples: [
        '<a href={userInput}>x</a>',
        '<a href="javascript:alert(1)">x</a>',
        '<iframe src={url} />'
      ],
      goodExamples: [
        '<a href="https://example.com">x</a>',
        '<a href={`/users/${id}`}>x</a>',
        '<img src="data:image/png;base64,..." />'
      ],
      falsePositives: [
        '动态 href={route} / href={config.url} / href={routerLink} 不在名称启发式内，不报；同理 href={url}、href={payload}、href={next}、href={target}、href={dest}、href={destination}、href={body}、href={req.body.next}、href={request.url}、href={data.url}、href={document.URL}、href={returnTo}、href={callback} 等均可能漏报（P0 保守边界）',
        '类型注解不参与名称启发（`safeValue as UserInput` 不会因 UserInput 误报）',
        'img 动态 src 不报；{...props} spread 与自定义组件的动态 href/src 不分析（P0 边界）',
        'data:image/avif、bmp 等不在安全 MIME 表，当前会报（P0 保守）',
        'vbscript: / file: / blob: 不在 P0 覆盖面'
      ]
    }
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        const elementName =
          node.name?.type === 'JSXIdentifier' ? node.name.name : ''
        const isIntrinsic = /^[a-z]/.test(elementName)
        for (const attr of node.attributes ?? []) {
          if (attr?.type !== 'JSXAttribute') continue
          if (attr.name?.type !== 'JSXIdentifier') continue
          const attrName = attr.name.name
          if (attrName !== 'href' && attrName !== 'src') continue

          const literal = staticString(attr)
          if (literal !== null) {
            if (isDangerousScheme(literal, attrName)) {
              context.report({
                node: attr,
                messageId: 'unsafeUrl',
                data: { name: attrName }
              })
            }
            continue
          }

          if (!isIntrinsic) continue // 自定义组件动态值不分析（P0）
          const targeted =
            (attrName === 'href' && HREF_ELEMENTS.has(elementName)) ||
            (attrName === 'src' && SRC_ELEMENTS.has(elementName))
          if (!targeted) continue
          const expr =
            attr.value?.type === 'JSXExpressionContainer'
              ? attr.value.expression
              : null
          if (expr && isDynamicUnsafe(expr, attrName)) {
            context.report({
              node: attr,
              messageId: 'unsafeUrl',
              data: { name: attrName }
            })
          }
        }
      }
    }
  }
}
