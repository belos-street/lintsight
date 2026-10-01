// @ts-nocheck invalid-2：constructor 内混用（void 一个、丢另一个）
class Pool {
  ready = false

  constructor() {
    void this.warm()
    this.open()
  }

  async warm() {
    this.ready = true
  }

  async open() {
    this.ready = this.ready && true
  }
}
