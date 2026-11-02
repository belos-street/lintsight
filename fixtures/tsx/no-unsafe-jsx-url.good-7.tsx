// @ts-nocheck valid-7：非可疑命名的动态值（P0 falsePositives 边界）
export function A(props: {
  url: string
  payload: string
  next: string
  target: string
  body: string
  request: { url: string }
  data: { url: string }
  returnTo: string
  callback: string
}) {
  return (
    <>
      <a href={props.url}>1</a>
      <a href={props.payload}>2</a>
      <a href={props.next}>3</a>
      <a href={props.target}>4</a>
      <a href={props.body}>5</a>
      <a href={props.request.url}>6</a>
      <a href={props.data.url}>7</a>
      <a href={props.returnTo}>8</a>
      <a href={props.callback}>9</a>
    </>
  )
}
