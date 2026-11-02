// @ts-nocheck invalid-9：data:text/html 模板（任意变量名）
export function A({ html }: { html: string }) {
  return <a href={`data:text/html,${html}`}>x</a>
}
