// @ts-nocheck invalid-3：iframe 动态 src（location 名称命中用户可控启发）
export function Frame() {
  return <iframe src={location.href} />
}
