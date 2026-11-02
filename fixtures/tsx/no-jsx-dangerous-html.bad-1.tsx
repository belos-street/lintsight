// @ts-nocheck invalid-1：JSX dangerouslySetInnerHTML
export function C({ html }: { html: string }) {
  return <div dangerouslySetInnerHTML={{ __html: html }} />
}
