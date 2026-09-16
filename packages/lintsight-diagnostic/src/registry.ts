/**
 * 规则注册表 v0（design-m1 §4.6）：四元组登记，双报消解的前置。
 * CI 校验见 test/registry.test.ts——新增规则必须同步登记，漏登记测试即红。
 */

import type { Owner } from './index'

export type DetectionLayer = 'syntax' | 'local' | 'taint'
export type RegistryStatus = 'active' | 'retired'

export interface RegistryEntry {
  ruleId: string
  owner: Owner
  detection: DetectionLayer
  status: RegistryStatus
}

export const registry: RegistryEntry[] = [
  {
    ruleId: 'lintsight/no-empty-catch',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active'
  },
  {
    ruleId: 'lintsight/no-async-array-method',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active'
  },
  {
    ruleId: 'lintsight/no-floating-promise',
    owner: 'lintsight-js',
    detection: 'local',
    status: 'active'
  },
  {
    ruleId: 'lintsight/no-swallowed-promise-error',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active'
  },
  {
    ruleId: 'lintsight/no-closure-loop-var',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active'
  },
  {
    ruleId: 'lintsight/no-array-map-side-effect',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active'
  },
  {
    ruleId: 'lintsight/no-json-structured-clone',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active'
  },
  {
    ruleId: 'lintsight/no-ignored-reduce-result',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active'
  },
  {
    ruleId: 'lintsight/no-empty-promise-catch',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active'
  },
  {
    ruleId: 'lintsight/no-async-constructor-call',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active'
  },
  {
    ruleId: 'lintsight/no-sync-io-in-async',
    owner: 'lintsight-js',
    detection: 'syntax',
    status: 'active'
  }
]

export function getRegistryEntry(ruleId: string): RegistryEntry | undefined {
  return registry.find((e) => e.ruleId === ruleId)
}

export function isRegistered(ruleId: string): boolean {
  return registry.some((e) => e.ruleId === ruleId)
}
