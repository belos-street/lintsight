// @ts-nocheck valid-2：锚定相对模板串
export function A({ id }: { id: string }) {
  return <a href={`/users/${id}`}>x</a>
}
