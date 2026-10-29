// @ts-nocheck valid-3：async 函数内部完整 try/catch（catch 不 rethrow）→ 调用不产生 unhandled
async function bootstrap() {
  try {
    await fetch('/api/data')
  } catch (error) {
    console.error(error)
  }
}

bootstrap()
