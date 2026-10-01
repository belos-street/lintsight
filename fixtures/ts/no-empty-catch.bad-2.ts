// @ts-nocheck invalid-2：带参数空 catch
export async function fetchUser(id: string) {
  try {
    return await fetch(`/api/users/${id}`);
  } catch (e) {
  }
}
