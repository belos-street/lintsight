// @ts-nocheck valid-1：非敏感键名（UI 偏好）
export function saveTheme(theme: string) {
  localStorage.setItem('ui-theme', theme)
}
