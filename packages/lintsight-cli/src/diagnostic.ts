/**
 * 统一诊断模型（SV6 · diagnostic-bridge 最小版）。
 *
 * 指纹口径偏差（spike ④ 实测结论，详见 docs/spikes/ 竖切报告）：
 * 设计 v0.2 §5.4 定义 fingerprint = hash(ruleId + file + span + messageId)，
 * 但 oxlint 1.83.0 的 `-f json` 输出无 messageId 字段（JS 插件规则同样只有渲染后文本），
 * M1 指纹降级为 message 文本参与哈希 —— 规则文案变更会导致指纹漂移，
 * 「messageId 变更走显式评审」的纪律同样适用于「message 文案变更」。
 */
import type { NormalizedDiagnostic } from './oxlint-bridge';

export const CONTRACT_VERSION = '0';

export interface LintsightSpan {
  offset: number;
  length: number;
  line: number;
  column: number;
}

export interface LintsightDiagnostic {
  contractVersion: string;
  ruleId: string;
  severity: string;
  message: string;
  /** 相对项目根路径（.vue 诊断已回映射） */
  file: string;
  span: LintsightSpan;
  fingerprint: string;
}

export function computeFingerprint(d: NormalizedDiagnostic): string {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(
    `${d.ruleId}\u0000${d.file}\u0000${d.span.offset}:${d.span.length}:${d.span.line}:${d.span.column}\u0000${d.message}`,
  );
  return hasher.digest('hex');
}

export function toLintsightDiagnostic(d: NormalizedDiagnostic): LintsightDiagnostic {
  return {
    contractVersion: CONTRACT_VERSION,
    ruleId: d.ruleId,
    severity: d.severity,
    message: d.message,
    file: d.file,
    span: d.span,
    fingerprint: computeFingerprint(d),
  };
}
