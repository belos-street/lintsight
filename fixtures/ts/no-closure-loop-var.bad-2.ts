// @ts-nocheck invalid-2：while + 循环体内 var + 函数声明捕获
export function poll(stop: () => boolean) {
  while (!stop()) {
    var attempt = attempts()
    function report() {
      return attempt
    }
    setTimeout(report, 50)
  }
}
