// @ts-nocheck invalid-2：.then 链作为语句（未 return / 未 await）
export function bootstrap() {
  Promise.resolve(1).then((v) => v + 1)
}
