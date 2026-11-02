// @ts-nocheck invalid-8：二元拼接静态危险前缀
export function A({ payload }: { payload: string }) {
  return <a href={'javascript:' + payload}>x</a>
}
