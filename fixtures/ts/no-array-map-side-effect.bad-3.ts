// @ts-nocheck invalid-3：多行 map 语句（隐式返回对象字面量）
export function render(users: { name: string }[]) {
  users.map((u) => ({
    name: u.name.toUpperCase()
  }))
}
