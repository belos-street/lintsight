// @ts-nocheck invalid-2：Math.random 参与运算后赋给 otp 命名变量
export function genOtp() {
  const otpSeed = Math.random() * 1000
  return otpSeed
}
