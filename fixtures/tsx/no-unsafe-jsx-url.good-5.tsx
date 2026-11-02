// @ts-nocheck valid-5：路由/配置命名不在用户输入启发式内（P0 精度边界）
const Foo = (props: { href: string }) => <span>{props.href}</span>

export function A({
  route,
  config,
  routerLink
}: {
  route: string
  config: { url: string }
  routerLink: string
}) {
  return (
    <>
      <a href={route}>r</a>
      <a href={config.url}>c</a>
      <a href={routerLink}>l</a>
      <Foo href={route}>f</Foo>
    </>
  )
}
