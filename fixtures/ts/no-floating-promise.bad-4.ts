// @ts-nocheck invalid-4：内部 try/catch 但 rethrow → 调用方仍未处理
async function load() {
  try {
    await fetch('/api/data')
  } catch (error) {
    throw error
  }
}

load()
