import type { GraphRef } from '../model/types';
import type { PageLinkKind } from '../parsing/pageParser';
import { isSamePath } from '../fs/paths';

export interface PageLinkSpec {
  readonly pageName: string;
  readonly kind: PageLinkKind;
  readonly label?: string;
}

/**
 * Replaceable strategy for how page links are written into Markdown.
 * Implementations must produce output that `parsePage` reads back as the same spec.
 */
export interface LinkRenderer {
  renderLocal(link: PageLinkSpec): string;
  renderExternal(link: PageLinkSpec, graph: GraphRef): string;
}

const SIMPLE_TAG = /^[^\s,!?;:"'()[\]{}#`]*[^\s,.!?;:"'()[\]{}#`]$/;

export function tagText(pageName: string): string {
  return SIMPLE_TAG.test(pageName) ? `#${pageName}` : `#[[${pageName}]]`;
}

/**
 * Local: `[[Page]]`, `#tag`, `{{embed [[Page]]}}`, `[label]([[Page]])`.
 * External: `[text](logseq://graph/<graph>?page=<page>)`; embeds add `&embed=true` and tags keep a
 * `#` label so both collapse back to their original form when the pages are reunited.
 */
export class LogseqUrlLinkRenderer implements LinkRenderer {
  renderLocal(link: PageLinkSpec): string {
    switch (link.kind) {
      case 'embed':
        return `{{embed [[${link.pageName}]]}}`;
      case 'tag':
        return tagText(link.pageName);
      default:
        return link.label === undefined ? `[[${link.pageName}]]` : `[${link.label}]([[${link.pageName}]])`;
    }
  }

  renderExternal(link: PageLinkSpec, graph: GraphRef): string {
    const embed = link.kind === 'embed' ? '&embed=true' : '';
    const url = `logseq://graph/${encodeUrlPart(graph.name)}?page=${encodeUrlPart(link.pageName)}${embed}`;
    const text = link.kind === 'tag' ? `#${link.pageName}` : (link.label ?? link.pageName);
    return `[${text}](${url})`;
  }
}

/** Like encodeURIComponent, but also escapes characters that would end a Markdown link target. */
function encodeUrlPart(value: string): string {
  return encodeURIComponent(value).replace(/[()'!*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** The canonical rule: representation depends only on the graph of the linking page and of the target. */
export function renderLink(
  renderer: LinkRenderer,
  fromGraph: GraphRef,
  link: PageLinkSpec,
  targetGraph: GraphRef,
): string {
  return isSamePath(fromGraph.path, targetGraph.path)
    ? renderer.renderLocal(link)
    : renderer.renderExternal(link, targetGraph);
}
