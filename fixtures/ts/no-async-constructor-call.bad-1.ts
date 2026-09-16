// invalid-1：constructor 调用 async 方法未 await
class Client {
  connected = false

  constructor() {
    this.connect()
  }

  async connect() {
    this.connected = true
  }
}
