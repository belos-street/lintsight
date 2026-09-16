// valid-1：let 声明 + 闭包——每次迭代独立绑定
export function scheduleFixed(items: string[]) {
  for (let i = 0; i < items.length; i++) {
    setTimeout(() => {
      console.log(items[i])
    }, 100)
  }
}
