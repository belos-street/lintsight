// @ts-nocheck valid-2：注释与模板字符串干扰不误伤已有语句的 catch（重新抛出）
export async function fetchUser(id: string) {
  try {
    return await fetch(`/api/users/${id}`);
  } catch (e) {
    // 网络错误统一上抛
    throw new Error(`fetch user ${id} failed`, { cause: e as Error });
  }
}
