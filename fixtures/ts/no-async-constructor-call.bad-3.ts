// invalid-3：.then 链不算 await
class Cache {
  loaded = false

  constructor() {
    this.load().then(() => {
      this.loaded = true
    })
  }

  async load() {
    this.loaded = true
  }
}
