// 去掉回复里简单的 Markdown 强调（**x** / __x__ / *x* / `x`），只保留文字。
// 规则偏保守：标记必须成对、紧贴文字、不跨行；算式里的单个 * 和撇号不动。
export function stripMarkdownEmphasis(text: string): string {
  return text
    .replace(/\*\*(?=\S)([^*\n]*?\S)\*\*/g, '$1')
    .replace(/(?<!\w)__(?=\S)([^_\n]*?\S)__(?!\w)/g, '$1')
    .replace(/(?<![\w*])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![\w*])/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
}
