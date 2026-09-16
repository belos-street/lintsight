/**
 * 规则注册表 v0（design-m1 §4.6）：四元组登记，双报消解的前置。
 * CI 校验（rules-core 每条规则必须在册）随 S3 rules-core 包落地后接入。
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
    status: 'active',
  },
]

export function getRegistryEntry(ruleId: string): RegistryEntry | undefined {
  return registry.find((e) => e.ruleId === ruleId)
}

export function isRegistered(ruleId: string): boolean {
  return registry.some((e) => e.ruleId === ruleId)
}
