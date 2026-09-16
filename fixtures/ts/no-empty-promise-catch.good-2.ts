// valid-2：catch 传递命名处理器（无法证明为空，保守不报）
import { handleFetchError } from './errors'

export function load5(url: string) {
  return fetch(url).catch(handleFetchError)
}
