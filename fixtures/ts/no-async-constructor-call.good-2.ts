// valid-2：同步初始化不受影响
class Pool2 {
  ready = false

  constructor() {
    this.setup()
  }

  setup() {
    this.ready = true
  }
}
