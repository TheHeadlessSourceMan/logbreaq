/** AST for Logseq Markdown pages. Link regeneration must operate on this, never on raw text. */
export type PageNode =
  | { readonly type: 'text'; readonly value: string }
  | { readonly type: 'page-ref'; readonly pageName: string; readonly raw: string }
  | { readonly type: 'page-embed'; readonly pageName: string; readonly raw: string }
  | { readonly type: 'markdown-link'; readonly label: string; readonly target: string; readonly raw: string }
  | { readonly type: 'asset-ref'; readonly assetPath: string; readonly raw: string }
  | { readonly type: 'block-ref'; readonly uuid: string; readonly raw: string };

export interface ParsedPage {
  readonly nodes: readonly PageNode[];
}

export function parsePage(_content: string): ParsedPage {
  // TODO
  return { nodes: [] };
}

export function serializePage(_page: ParsedPage): string {
  // TODO
  return '';
}
