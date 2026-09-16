// valid-2：回调无 return 的 map 语句由映射清单 array-callback-return 管，不在本条范围
export function wrongButOtherRule(users: string[]) {
  users.map((u) => {
    console.log(u)
  })
  users.forEach((u) => send(u))
}
