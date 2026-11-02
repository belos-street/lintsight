// @ts-nocheck invalid-1：JSX dangerouslySetInnerHTML（.jsx）
export function C({ html }) {
  return <div dangerouslySetInnerHTML={{ __html: html }} />
}
