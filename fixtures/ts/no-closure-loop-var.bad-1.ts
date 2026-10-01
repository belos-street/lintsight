// @ts-nocheck invalid-1：for + var + 闭包捕获（经典 setTimeout 陷阱）
export function schedule(items: string[]) {
  for (var i = 0; i < items.length; i++) {
    setTimeout(() => {
      console.log(items[i])
    }, 100)
  }
}
