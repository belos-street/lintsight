// @ts-nocheck invalid-10：data:image/svg+xml 模板（SVG 可携带脚本）
export function A({ svg }: { svg: string }) {
  return <a href={`data:image/svg+xml,${svg}`}>x</a>
}
