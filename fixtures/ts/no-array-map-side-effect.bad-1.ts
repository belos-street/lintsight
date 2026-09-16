// invalid-1：map 结果被丢弃且回调隐式返回
export function notify(users: string[]) {
  users.map((u) => send(u))
}
