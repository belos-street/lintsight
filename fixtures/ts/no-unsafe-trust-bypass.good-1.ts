// @ts-nocheck safe-1：纯字面量实参（静态内容，与 no-innerhtml-assignment 单 severity 口径一致）
export function bindStatic () {
  this.searchValue = this.sanitizer.bypassSecurityTrustHtml('<b>static</b>')
}
