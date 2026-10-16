/**
 * 规则注册表 v0（design-m1 §4.6）：登记四元组 + confidence + 元数据，双报消解的前置。
 * confidence 为平台侧账目（T1.19 试用误报标注的反哺载体），与规则 meta.confidence
 * 由 test/registry.test.ts 一致性校验联动。
 * description/defaultSeverity（M3）：SARIF rules[] 元数据源，JS 条目与插件 meta
 * 逐字一致（test/registry.test.ts 校验），供平台侧规则面展示。
 * CI 校验见 test/registry.test.ts——新增规则必须同步登记，漏登记测试即红。
 */

import type { Owner } from './index'

export type DetectionLayer = 'syntax' | 'local' | 'taint'
export type RegistryStatus = 'active' | 'retired'
export type Confidence = 'high' | 'medium' | 'low'
export type DefaultSeverity = 'error' | 'warning'

export interface RegistryEntry {
  ruleId: string
  owner: Owner
  detection: DetectionLayer
  status: RegistryStatus
  /** 平台侧置信账目，与 meta.confidence 联动校验；试用误报证据反哺调整 */
  confidence: Confidence
  /** 一句话规则说明（SARIF shortDescription）；JS 条目 = 插件 meta.docs.description */
  description: string
  /** 缺省严重级（SARIF defaultConfiguration.level）；JS 条目 = 插件 meta.severity */
  defaultSeverity: DefaultSeverity
  /** M2 双报消解（design-m2 §4.4）：本规则（engine 数据流版）命中时，
   * 同文件同行被列出的 JS 语法级规则诊断在合并层抑制。
   * 仅 owner=lintsight-engine 条目使用；目标必须是在册 lintsight-js 规则。 */
  supersedes?: string[]
}

export const registry: RegistryEntry[] = [
  {
    ruleId: 'lintsight/no-empty-catch',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active',
    confidence: 'high',
    description: '禁止空的 catch 块',
    defaultSeverity: 'error'
  },
  {
    ruleId: 'lintsight/no-async-array-method',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active',
    confidence: 'high',
    description: '禁止向 forEach/map/filter/reduce 等数组方法传入 async 回调',
    defaultSeverity: 'error'
  },
  {
    ruleId: 'lintsight/no-floating-promise',
    owner: 'lintsight-js',
    detection: 'local',
    status: 'active',
    confidence: 'medium',
    description:
      '禁止产生未处理的 Promise（表达式语句中的 Promise 值未 await / void / return）',
    defaultSeverity: 'error'
  },
  {
    ruleId: 'lintsight/no-swallowed-promise-error',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active',
    confidence: 'medium',
    description: '禁止 catch 到错误后既不引用也不重新抛出',
    defaultSeverity: 'error'
  },
  {
    ruleId: 'lintsight/no-closure-loop-var',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active',
    confidence: 'high',
    description: '禁止循环内 var 声明的变量被闭包捕获',
    defaultSeverity: 'error'
  },
  {
    ruleId: 'lintsight/no-array-map-side-effect',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active',
    confidence: 'medium',
    description: '禁止丢弃 map 的返回结果（回调有返回值却被当作语句执行）',
    defaultSeverity: 'warning'
  },
  {
    ruleId: 'lintsight/no-json-structured-clone',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active',
    confidence: 'high',
    description: '禁止用 JSON 序列化做深拷贝',
    defaultSeverity: 'warning'
  },
  {
    ruleId: 'lintsight/no-ignored-reduce-result',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active',
    confidence: 'high',
    description: '禁止丢弃 reduce/reduceRight 的聚合结果',
    defaultSeverity: 'error'
  },
  {
    ruleId: 'lintsight/no-empty-promise-catch',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active',
    // T1.19 首例误报标注（text-rpg 写队列隔离模式）：high → medium
    confidence: 'medium',
    description: '禁止 .catch(() => {}) 形式的静默吞错',
    defaultSeverity: 'error'
  },
  {
    ruleId: 'lintsight/no-async-constructor-call',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active',
    confidence: 'medium',
    description: '禁止 constructor 中调用本类 async 方法而不 await / void',
    defaultSeverity: 'warning'
  },
  {
    ruleId: 'lintsight/no-sync-io-in-async',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active',
    confidence: 'high',
    description: '禁止在 async 函数内调用文件系统同步 API',
    defaultSeverity: 'warning'
  },
  {
    ruleId: 'lintsight/no-hardcoded-credentials',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active',
    confidence: 'medium',
    description:
      '禁止硬编码凭证（password/secret/token/api_key 等命名 + 字符串字面量）',
    defaultSeverity: 'error'
  },
  {
    ruleId: 'lintsight/no-unsafe-regex',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active',
    confidence: 'high',
    description: '检测正则中的嵌套量词（ReDoS 静态特征）',
    defaultSeverity: 'warning'
  },
  {
    ruleId: 'lintsight/no-prototype-pollution-syntax',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active',
    confidence: 'high',
    description: '禁止通过字面量/计算键写 __proto__ 与 constructor.prototype',
    defaultSeverity: 'error'
  },
  {
    ruleId: 'lintsight/no-child-process-nonliteral',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active',
    confidence: 'medium',
    description: '禁止 child_process.exec/execSync 执行非字面量命令',
    defaultSeverity: 'error'
  },
  {
    ruleId: 'lintsight/no-non-literal-fs-filename',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active',
    confidence: 'low',
    description: 'fs 文件 API 路径参数为非字面量时提示路径穿越风险',
    defaultSeverity: 'warning'
  },
  {
    ruleId: 'lintsight/no-non-literal-require',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active',
    confidence: 'high',
    description: '禁止 require()/import() 的模块说明符为非字面量',
    defaultSeverity: 'error'
  },
  {
    ruleId: 'lintsight/no-weak-hash',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active',
    confidence: 'high',
    description: '禁止 MD5/SHA1 哈希（crypto.createHash 字面量参数）',
    defaultSeverity: 'warning'
  },
  {
    ruleId: 'lintsight/no-math-random-secret',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active',
    confidence: 'medium',
    description:
      '禁止 Math.random 赋值给敏感命名标识符（token/secret/otp/salt 等）',
    defaultSeverity: 'error'
  },
  {
    ruleId: 'lintsight/no-sensitive-storage',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active',
    confidence: 'medium',
    description: '禁止向 localStorage/sessionStorage 写入凭证命名键',
    defaultSeverity: 'error'
  },
  {
    ruleId: 'lintsight/no-innerhtml-assignment',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active',
    confidence: 'medium',
    description: '禁止向 innerHTML/outerHTML/document.write 写入非字面量内容',
    defaultSeverity: 'error'
  },
  {
    ruleId: 'lintsight/no-sql-concat',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active',
    confidence: 'medium',
    description: '禁止模板插值/字符串拼接构造 SQL 语句',
    defaultSeverity: 'error'
  },
  {
    ruleId: 'lintsight/no-cors-wildcard',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active',
    confidence: 'high',
    description:
      '禁止 CORS 通配来源（Access-Control-Allow-Origin: * 或 cors origin:true）',
    defaultSeverity: 'warning'
  },
  {
    ruleId: 'lintsight/no-vm-dynamic-code',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active',
    confidence: 'medium',
    description: '禁止 vm.runInContext 系执行非字面量脚本',
    defaultSeverity: 'error'
  },
  {
    ruleId: 'lintsight/no-insecure-cookie',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active',
    confidence: 'medium',
    description: 'Set-Cookie 缺少 HttpOnly/Secure 标志',
    defaultSeverity: 'warning'
  },
  // —— M3 召回扩充（juice-shop pending-human 收敛） ——
  {
    ruleId: 'lintsight/no-unsafe-trust-bypass',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active',
    confidence: 'medium',
    description:
      '禁止向 Angular bypassSecurityTrust* 传入非字面量内容（绕过 XSS 防护）',
    defaultSeverity: 'error'
  },
  {
    ruleId: 'lintsight/no-serve-index',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active',
    confidence: 'high',
    description:
      '禁止用 serveIndex/serve-index 开启目录浏览（文件名/元数据暴露）',
    defaultSeverity: 'warning'
  },

  // —— M2 引擎规则（T2.3~T2.4 起；design-m2 §4.2 ruleId 命名空间 lintsight-engine/<name>） ——
  {
    ruleId: 'lintsight-engine/no-eval',
    owner: 'lintsight-engine',
    detection: 'syntax',
    status: 'active',
    confidence: 'high',
    description: 'eval() 动态代码执行（CWE-95）',
    defaultSeverity: 'error'
  },
  {
    ruleId: 'lintsight-engine/no-path-traversal',
    owner: 'lintsight-engine',
    detection: 'taint',
    status: 'active',
    confidence: 'high',
    description: '外部可控文件名未消毒抵达 fs 读写（CWE-22）',
    defaultSeverity: 'error',
    // 数据流版命中（含证据链）时抑制同位置的语法级低置信版本（M2-DR5/§4.4 归属矩阵）
    supersedes: ['lintsight/no-non-literal-fs-filename']
  },
  {
    ruleId: 'lintsight-engine/no-command-injection',
    owner: 'lintsight-engine',
    detection: 'taint',
    status: 'active',
    confidence: 'high',
    description: '外部可控输入抵达 shell 执行（CWE-78）',
    defaultSeverity: 'error',
    // 同模式：taint 版（污染源才报）命中 → 抑制语法级超集（任何非字面量都报）同位置诊断
    supersedes: ['lintsight/no-child-process-nonliteral']
  },
  {
    ruleId: 'lintsight-engine/no-ssrf',
    owner: 'lintsight-engine',
    detection: 'taint',
    status: 'active',
    confidence: 'medium',
    description: '外部可控 URL 抵达服务端出站请求（CWE-918）',
    defaultSeverity: 'error'
  },
  {
    ruleId: 'lintsight-engine/no-prototype-pollution-merge',
    owner: 'lintsight-engine',
    detection: 'taint',
    status: 'active',
    confidence: 'medium',
    description: '可控对象流入合并/深写目标（CWE-1321）',
    defaultSeverity: 'error'
  },
  {
    ruleId: 'lintsight-engine/arch-boundaries',
    owner: 'lintsight-engine',
    detection: 'local',
    status: 'active',
    confidence: 'high',
    description: 'zone 依赖方向约束（配置驱动）',
    defaultSeverity: 'error'
  },
  {
    ruleId: 'lintsight-engine/no-import-cycle',
    owner: 'lintsight-engine',
    detection: 'local',
    status: 'active',
    // FR-304② 循环依赖（opt-in）：词法解析口径（动态 import 非字面量/npm 包不解析）
    // → 保守近似，环报告的语义本身确定性高，但覆盖有边界
    confidence: 'medium',
    description: '循环依赖（Tarjan SCC；type-only 边不计）',
    defaultSeverity: 'error'
  },
  {
    ruleId: 'lintsight-engine/no-deep-import',
    owner: 'lintsight-engine',
    detection: 'local',
    status: 'active',
    // FR-304③ exports 面约束（opt-in）：只约束声明 exports 的 workspace 包，
    // 条件分支不解析 → 键集超近似（凡键存在即放行）
    confidence: 'medium',
    description: '绕过 package.json exports 公共 API 的深导入',
    defaultSeverity: 'error'
  },
  {
    ruleId: 'lintsight-engine/no-open-redirect',
    owner: 'lintsight-engine',
    detection: 'taint',
    status: 'active',
    // M3 召回扩充（CWE-601）：可变量直达重定向 sink 即报；=== 精确校验的
    // 分支控制流不可判（v0 过程内口径），allowlist 子串匹配绕过属语义级——
    // 保守报告面，confidence 不上 high
    confidence: 'medium',
    description: '外部可控 URL 未精确匹配校验即进入重定向（开放重定向/钓鱼）',
    defaultSeverity: 'warning'
  }
]

export function getRegistryEntry(ruleId: string): RegistryEntry | undefined {
  return registry.find((e) => e.ruleId === ruleId)
}

export function isRegistered(ruleId: string): boolean {
  return registry.some((e) => e.ruleId === ruleId)
}
