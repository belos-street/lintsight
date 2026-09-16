// invalid-3：量词修饰的分组后再接量词
export function matchDigits(input: string) {
  return /(\d+)*\d/.exec(input)
}
