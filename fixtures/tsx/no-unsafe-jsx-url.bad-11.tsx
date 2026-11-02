// @ts-nocheck invalid-11：转义冒号（cooked 归一化）
export function A() {
  return <a href={`\u006aavascript\u003aalert(1)`}>x</a>
}
