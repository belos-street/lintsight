// @ts-nocheck valid-2：读取不触发（只有 setItem 落盘面）
export function readSession() {
  return localStorage.getItem('token')
}

export function saveCart(cart: unknown) {
  sessionStorage.setItem('cart', JSON.stringify(cart))
}
