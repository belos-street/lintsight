// @ts-nocheck invalid-1：innerHTML 右值为变量（XSS 面）
export function render(el: HTMLElement, userInput: string) {
  el.innerHTML = userInput
}
