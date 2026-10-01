// allowComments 开启 + catch 带注释占位 → 放行（T1.13 契约）
export function parseConfig(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    // 格式错误的配置直接忽略，按默认配置启动
  }
  return undefined;
}
