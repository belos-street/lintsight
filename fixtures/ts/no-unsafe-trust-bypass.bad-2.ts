// @ts-nocheck invalid-2：模板串插值绕过 Html 信任（另一种 trust 方法 + 另一种实参形态）
export function renderCaption (userInput: string) {
  el.innerHTML = this.sanitizer.bypassSecurityTrustHtml(`<b>${userInput}</b>`)
}
