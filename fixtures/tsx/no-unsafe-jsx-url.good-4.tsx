// @ts-nocheck valid-4：img 动态 src / 自定义组件动态 href 不分析
const Foo = (props: { href: string }) => <span>{props.href}</span>

export function Img({ url }: { url: string }) {
  return (
    <>
      <img src={url} />
      <Foo href={url} />
    </>
  )
}
