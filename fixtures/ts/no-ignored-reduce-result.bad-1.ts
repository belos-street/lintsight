// invalid-1：reduce 返回值被丢弃
export function touch(items: number[]) {
  items.reduce((acc, n) => acc + n, 0)
}
