// invalid-2：sessionStorage 存储密码命名键
export function saveUser(user: string, pwd: string) {
  sessionStorage.setItem('userPassword', pwd)
}
