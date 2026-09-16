// invalid-3：cors({ origin: true }) 反射任意来源
import cors from 'cors'

export function useCors() {
  return cors({ origin: true })
}
