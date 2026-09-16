// invalid-2：模板字符串含插值
export function renderCard(el: HTMLElement, name: string) {
  el.innerHTML = `<div class="card">${name}</div>`
}
