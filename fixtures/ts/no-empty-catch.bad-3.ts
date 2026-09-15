// invalid-3：嵌套 try + TS 断言语法共存（预期 2 条诊断）
type Payload = { data?: unknown };

export function handle(input: string): Payload {
  try {
    try {
      return { data: JSON.parse(input) as Payload };
    } catch {
    }
  } catch (e) {
  }
  return {};
}
