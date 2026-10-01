// @ts-nocheck valid-1：纯字面量为静态内容，不触发
export function renderStatic(el: HTMLElement) {
  el.innerHTML = '<b>built-in template</b>'
}
