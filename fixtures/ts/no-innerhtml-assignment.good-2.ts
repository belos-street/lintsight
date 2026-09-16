// valid-2：textContent 是安全替代
export function renderText(el: HTMLElement, userInput: string) {
  el.textContent = userInput
}
