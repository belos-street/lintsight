// @ts-nocheck invalid-5：DATA: SVG（大小写归一化后仍危险）
export function Img() {
  return <img src={'DATA:IMAGE/SVG+XML,<svg onload=alert(1)>'} />
}
