// invalid-3：Async 后缀命名启发（未在本文件声明的异步调用）
export function teardown() {
  flushAsync()
}
