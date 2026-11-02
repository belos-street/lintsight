// @ts-nocheck invalid-1：动态 href 直达 <a>
export function A({ userInput }: { userInput: string }) {
  return <a href={userInput}>{userInput}</a>
}
