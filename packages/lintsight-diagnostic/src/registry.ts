/**
 * 规则注册表 v0（design-m1 §4.6）：登记四元组 + confidence，双报消解的前置。
 * confidence 为平台侧账目（T1.19 试用误报标注的反哺载体），与规则 meta.confidence
 * 由 test/registry.test.ts 一致性校验联动。
 * CI 校验见 test/registry.test.ts——新增规则必须同步登记，漏登记测试即红。
 */

import type { Owner } from './index'

export type DetectionLayer = 'syntax' | 'local' | 'taint'
export type RegistryStatus = 'active' | 'retired'
export type Confidence = 'high' | 'medium' | 'low'

export interface RegistryEntry {
  ruleId: string
  owner: Owner
  detection: DetectionLayer
  status: RegistryStatus
  /** 平台侧置信账目，与 meta.confidence 联动校验；试用误报证据反哺调整 */
  confidence: Confidence
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
    confidence: 'high'
  },
  {
    ruleId: 'lintsight/no-async-array-method',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active',
    confidence: 'high'
  },
  {
    ruleId: 'lintsight/no-floating-promise',
    owner: 'lintsight-js',
    detection: 'local',
    status: 'active',
    confidence: 'medium'
  },
  {
    ruleId: 'lintsight/no-swallowed-promise-error',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active',
    confidence: 'medium'
  },
  {
    ruleId: 'lintsight/no-closure-loop-var',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active',
    confidence: 'high'
  },
  {
    ruleId: 'lintsight/no-array-map-side-effect',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active',
    confidence: 'medium'
  },
  {
    ruleId: 'lintsight/no-json-structured-clone',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active',
    confidence: 'high'
  },
  {
    ruleId: 'lintsight/no-ignored-reduce-result',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active',
    confidence: 'high'
  },
  {
    ruleId: 'lintsight/no-empty-promise-catch',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active',
    // T1.19 首例误报标注（text-rpg 写队列隔离模式）：high → medium
    confidence: 'medium'
  },
  {
    ruleId: 'lintsight/no-async-constructor-call',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active',
    confidence: 'medium'
  },
  {
    ruleId: 'lintsight/no-sync-io-in-async',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active',
    confidence: 'high'
  },
  {
    ruleId: 'lintsight/no-hardcoded-credentials',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active',
    confidence: 'medium'
  },
  {
    ruleId: 'lintsight/no-unsafe-regex',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active',
    confidence: 'high'
  },
  {
    ruleId: 'lintsight/no-prototype-pollution-syntax',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active',
    confidence: 'high'
  },
  {
    ruleId: 'lintsight/no-child-process-nonliteral',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active',
    confidence: 'medium'
  },
  {
    ruleId: 'lintsight/no-non-literal-fs-filename',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active',
    confidence: 'low'
  },
  {
    ruleId: 'lintsight/no-non-literal-require',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active',
    confidence: 'high'
  },
  {
    ruleId: 'lintsight/no-weak-hash',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active',
    confidence: 'high'
  },
  {
    ruleId: 'lintsight/no-math-random-secret',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active',
    confidence: 'medium'
  },
  {
    ruleId: 'lintsight/no-sensitive-storage',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active',
    confidence: 'medium'
  },
  {
    ruleId: 'lintsight/no-innerhtml-assignment',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active',
    confidence: 'medium'
  },
  {
    ruleId: 'lintsight/no-sql-concat',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active',
    confidence: 'medium'
  },
  {
    ruleId: 'lintsight/no-cors-wildcard',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active',
    confidence: 'high'
  },
  {
    ruleId: 'lintsight/no-vm-dynamic-code',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active',
    confidence: 'medium'
  },
  {
    ruleId: 'lintsight/no-insecure-cookie',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active',
    confidence: 'medium'
  },

  // —— M2 引擎规则（T2.3~T2.4 起；design-m2 §4.2 ruleId 命名空间 lintsight-engine/<name>） ——
  {
    ruleId: 'lintsight-engine/no-eval',
    owner: 'lintsight-engine',
    detection: 'syntax',
    status: 'active',
    confidence: 'high'
  },
  {
    ruleId: 'lintsight-engine/no-path-traversal',
    owner: 'lintsight-engine',
    detection: 'taint',
    status: 'active',
    confidence: 'high',
    // 数据流版命中（含证据链）时抑制同位置的语法级低置信版本（M2-DR5/§4.4 归属矩阵）
    supersedes: ['lintsight/no-non-literal-fs-filename']
  },
  {
    ruleId: 'lintsight-engine/arch-boundaries',
    owner: 'lintsight-engine',
    detection: 'local',
    status: 'active',
    confidence: 'high'
  }
]

export function getRegistryEntry(ruleId: string): RegistryEntry | undefined {
  return registry.find((e) => e.ruleId === ruleId)
}

export function isRegistered(ruleId: string): boolean {
  return registry.some((e) => e.ruleId === ruleId)
}
