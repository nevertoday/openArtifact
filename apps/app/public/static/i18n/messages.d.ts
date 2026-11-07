/** Every language's dictionary has the shape of the Chinese one, which the others are checked against. */
export type Messages = typeof import('./zh-CN.js').default
