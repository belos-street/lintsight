// @ts-nocheck invalid-1：Angular bypassSecurityTrust 绑定用户输入（juice-shop localXss 形态）
export function filterTable (queryParam: string) {
  const searchValue = this.sanitizer.bypassSecurityTrustResourceUrl(queryParam)
  this.searchValue = searchValue
}
