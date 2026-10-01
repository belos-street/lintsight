// @ts-nocheck valid-1：map 结果被使用
export function getNames(users: { name: string }[]) {
  return users.map((u) => u.name)
}
