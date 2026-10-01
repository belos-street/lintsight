// allowComments 开启 + catch 无注释 → 仍报（选项不放行零语句零注释）
export function parseConfig(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
  }
  return undefined;
}
