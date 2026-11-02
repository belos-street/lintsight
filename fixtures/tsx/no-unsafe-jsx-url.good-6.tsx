// @ts-nocheck valid-6：类型注解不参与名称启发（UserInput 不应误报）
type UserInput = string
const safeValue = '/safe'

export function A() {
  return <a href={safeValue as UserInput}>x</a>
}
