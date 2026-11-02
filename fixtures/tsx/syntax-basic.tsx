// @ts-nocheck 语法契约：fragment / 泛型箭头 / spread
const identity = <T,>(x: T): T => x

export function Basic({ items }: { items: string[] }) {
  return (
    <>
      <ul {...{ id: 'list' }}>
        {items.map((item) => (
          <li key={item}>{identity(item)}</li>
        ))}
      </ul>
    </>
  )
}
