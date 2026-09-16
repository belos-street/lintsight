// invalid-3：对象字面量 __proto__ 键（会触发真实原型语义）
export function make(payload: unknown) {
  return { '__proto__': payload, a: 1 }
}
