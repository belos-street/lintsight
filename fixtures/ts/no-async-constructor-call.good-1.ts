// @ts-nocheck valid-1：constructor 中的 async 调用必须 void 显式标注
class Client2 {
  connected = false

  constructor() {
    void this.connect()
  }

  async connect() {
    this.connected = true
  }
}
