// invalid-2：RegExp 构造器的嵌套量词
export function build() {
  return new RegExp('(a+)*b')
}
