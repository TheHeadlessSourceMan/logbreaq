import type { GraphRef } from '../model/types';
import { isSamePath } from '../fs/paths';

export interface LinkTarget {
  readonly pageName: string;
  readonly graph: GraphRef;
}

/** Replaceable strategy for how page links are written into Markdown. */
export interface LinkRenderer {
  renderLocal(pageName: string, label?: string): string;
  renderExternal(target: LinkTarget, label?: string): string;
}

/** Local: `[[Page]]`. External: `[Page](logseq://graph/<graph>?page=<page>)`. */
export class LogseqUrlLinkRenderer implements LinkRenderer {
  renderLocal(pageName: string, label?: string): string {
    return label === undefined ? `[[${pageName}]]` : `[${label}]([[${pageName}]])`;
  }

  renderExternal(target: LinkTarget, label?: string): string {
    const url = `logseq://graph/${encodeURIComponent(target.graph.name)}?page=${encodeURIComponent(target.pageName)}`;
    return `[${label ?? target.pageName}](${url})`;
  }
}

/** The canonical rule: representation depends only on the source and target graph. */
export function renderLink(
  renderer: LinkRenderer,
  fromGraph: GraphRef,
  target: LinkTarget,
  label?: string,
): string {
  return isSamePath(fromGraph.path, target.graph.path)
    ? renderer.renderLocal(target.pageName, label)
    : renderer.renderExternal(target, label);
}
