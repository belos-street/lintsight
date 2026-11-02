// @ts-nocheck invalid-6：成员链中的用户输入命名（req.query.next）
export function A(req: { query: { next: string } }) {
  return <a href={req.query.next}>x</a>
}
