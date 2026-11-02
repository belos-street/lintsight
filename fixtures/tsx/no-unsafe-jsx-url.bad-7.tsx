// @ts-nocheck invalid-7：模板串静态危险前缀 + 任意变量名
export function A({ payload }: { payload: string }) {
  return <a href={`javascript:${payload}`}>x</a>
}
