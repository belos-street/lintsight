// @ts-nocheck valid-1：catch 内有实际处理（safe case：清洗后的输入 + 安全替代写法）
export function loadConfig(path: string): unknown {
  try {
    return JSON.parse(path);
  } catch (e) {
    console.error('failed to parse config', e);
    return null;
  }
}
