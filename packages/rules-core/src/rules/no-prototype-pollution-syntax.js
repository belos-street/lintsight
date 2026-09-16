/** no-prototype-pollution-syntax —— P0 安全（v0.1① #3，CWE-1321 / OWASP A08，◆ M2 taint 接管）。 */
export default {
  meta: {
    category: 'security',
    severity: 'error',
    confidence: 'high',
    typeRequirement: 'none',
    tags: ['cwe-1321', 'owasp-a08'],
    fixable: undefined,
    messages: {
      protoKey:
        'Writing to "__proto__"/"constructor.prototype" pollutes Object.prototype for every object; use Object.defineProperty or a Map. (no-prototype-pollution-syntax)'
    },
    docs: {
      description: '禁止通过字面量/计算键写 __proto__ 与 constructor.prototype',
      rationale:
        '对 __proto__ 或 constructor.prototype 的写入会污染全局对象原型，影响所有对象实例——原型污染攻击的语法面。合并函数的数据流面由 M2 taint 接管（◆）。',
      badExamples: [
        "obj['__proto__'] = payload",
        "ctor['constructor']['prototype'] = payload"
      ],
      goodExamples: [
        'Object.defineProperty(obj, key, { value })',
        'const bag = new Map()'
      ],
      falsePositives: [
        '与内置 no-proto 分工：内置管标识符访问（obj.__proto__），本条管字面量/计算键与合并面'
      ]
    }
  },
  create(context) {
    function report(node) {
      context.report({ node, messageId: 'protoKey' })
    }

    return {
      Property(node) {
        const key = node.key
        const isProtoKey =
          (key?.type === 'Literal' && key.value === '__proto__') ||
          (key?.type === 'Identifier' && key.name === '__proto__')
        if (isProtoKey && node.kind === 'init') report(node)
      },
      MemberExpression(node) {
        if (
          node.computed &&
          node.property?.type === 'Literal' &&
          node.property.value === '__proto__'
        ) {
          report(node)
          return
        }
        // ctor.constructor.prototype / obj['constructor']['prototype']（标识符与字面量键都算）
        const propName =
          node.property?.type === 'Identifier'
            ? node.property.name
            : node.property?.value
        if (propName === 'prototype') {
          const obj = node.object
          if (obj?.type === 'MemberExpression') {
            const objProp =
              obj.property?.type === 'Identifier'
                ? obj.property.name
                : obj.property?.value
            if (objProp === 'constructor') report(node)
          }
        }
      }
    }
  }
}
