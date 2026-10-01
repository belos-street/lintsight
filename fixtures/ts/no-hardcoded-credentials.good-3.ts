// valid-3：裸 token 属性承载非凭证语义（如 diff 算法的词元）——值不具备凭证形态时不触发
export const diffOps = [
  { type: 'equal', token: 'really' },
  { type: 'extra', token: 'pipeline' }
]
