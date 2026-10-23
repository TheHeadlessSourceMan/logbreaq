/**
 * Lossless tokenizer for Logseq Markdown pages: `serializePage(parsePage(x)) === x` for every input.
 * Link regeneration operates on these nodes, never on raw text.
 *
 * Recognized: `[[Page]]`, `#tag`, `#[[Page]]`, `{{embed [[Page]]}}`, `[label]([[Page]])`,
 * `[label](logseq://graph/G?page=P)`, asset links `![x](../assets/f.png)`, block refs `((uuid))`.
 * Code spans, fenced code and other macros (e.g. queries) are opaque text.
 */
export type PageLinkKind = 'ref' | 'tag' | 'embed';

export interface TextNode {
  readonly type: 'text';
  readonly raw: string;
}

export interface PageLinkNode {
  readonly type: 'page-link';
  readonly kind: PageLinkKind;
  readonly pageName: string;
  readonly label?: string;
  /** Set when the link points into another graph via a logseq:// URL. */
  readonly external?: { readonly graphName: string };
  readonly raw: string;
}

export interface AssetNode {
  readonly type: 'asset';
  readonly isEmbed: boolean;
  readonly label: string;
  readonly path: string;
  /** Optional title part including its leading whitespace, e.g. ` "caption"`. */
  readonly title: string;
  readonly raw: string;
}

export interface BlockRefNode {
  readonly type: 'block-ref';
  readonly uuid: string;
  readonly raw: string;
}

export type PageNode = TextNode | PageLinkNode | AssetNode | BlockRefNode;

export interface ParsedPage {
  readonly nodes: readonly PageNode[];
}

const EMBED = /\{\{embed\s+\[\[([^\]\n]+?)\]\]\s*\}\}/y;
const BLOCK_REF = /\(\(([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)\)/y;
const LABELED_PAGE_REF = /\[([^[\]\n]*)\]\(\[\[([^\]\n]+?)\]\]\)/y;
const MARKDOWN_LINK = /(!?)\[([^[\]\n]*)\]\((<[^>\n]*>|[^\s()<>]+)((?:\s+"[^"\n]*")?)\)/y;
const TAG = /#([^\s,!?;:"'()[\]{}#`]*[^\s,.!?;:"'()[\]{}#`])/y;
const ASSET_PATH = /^(?:\.\.\/|\.\/|\/)?assets\//;
const TAG_PREFIX = /[\s([{,;>]/;

function matchAt(re: RegExp, s: string, index: number): RegExpExecArray | null {
  re.lastIndex = index;
  return re.exec(s);
}

/** Returns the index just past the `]]` matching the `[[` at `start`, or -1. Single-line only. */
function closingBrackets(s: string, start: number): number {
  let depth = 0;
  let j = start;
  while (j < s.length) {
    if (s.startsWith('[[', j)) {
      depth += 1;
      j += 2;
    } else if (s.startsWith(']]', j)) {
      depth -= 1;
      j += 2;
      if (depth === 0) {
        return j;
      }
    } else if (s[j] === '\n') {
      return -1;
    } else {
      j += 1;
    }
  }
  return -1;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseLogseqPageUrl(
  url: string,
): { graphName: string; pageName: string; embed: boolean } | undefined {
  const match = /^logseq:\/\/graph\/([^?#]+)\?([^#]*)$/.exec(url);
  if (match === null) {
    return undefined;
  }
  const params = new URLSearchParams(match[2]!);
  const pageName = params.get('page');
  if (pageName === null || pageName === '') {
    return undefined;
  }
  return { graphName: safeDecode(match[1]!), pageName, embed: params.get('embed') === 'true' };
}

function classifyMarkdownLink(match: RegExpExecArray): PageNode | undefined {
  const [raw, bang, label, rawUrl, title] = match as unknown as [string, string, string, string, string];
  const url = rawUrl.startsWith('<') ? rawUrl.slice(1, -1) : rawUrl;
  if (bang === '') {
    const external = parseLogseqPageUrl(url);
    if (external !== undefined) {
      const { pageName } = external;
      const isTag = label === `#${pageName}` || label === `#[[${pageName}]]`;
      const kind: PageLinkKind = external.embed ? 'embed' : isTag ? 'tag' : 'ref';
      return {
        type: 'page-link',
        kind,
        pageName,
        ...(kind === 'ref' && label !== pageName ? { label } : {}),
        external: { graphName: external.graphName },
        raw,
      };
    }
  }
  if (ASSET_PATH.test(url)) {
    return { type: 'asset', isEmbed: bang === '!', label, path: url, title, raw };
  }
  return undefined;
}

export function parsePage(content: string): ParsedPage {
  const nodes: PageNode[] = [];
  let text = '';
  let i = 0;

  const emit = (node: PageNode): void => {
    if (text !== '') {
      nodes.push({ type: 'text', raw: text });
      text = '';
    }
    nodes.push(node);
    i += node.raw.length;
  };
  const literal = (length: number): void => {
    text += content.slice(i, i + length);
    i += length;
  };

  while (i < content.length) {
    const ch = content[i]!;

    if (content.startsWith('```', i)) {
      const end = content.indexOf('```', i + 3);
      literal(end === -1 ? content.length - i : end + 3 - i);
      continue;
    }
    if (ch === '`') {
      const end = content.indexOf('`', i + 1);
      const newline = content.indexOf('\n', i + 1);
      literal(end !== -1 && (newline === -1 || end < newline) ? end + 1 - i : 1);
      continue;
    }
    if (content.startsWith('{{', i)) {
      const embed = matchAt(EMBED, content, i);
      if (embed !== null) {
        emit({ type: 'page-link', kind: 'embed', pageName: embed[1]!.trim(), raw: embed[0] });
        continue;
      }
      const end = content.indexOf('}}', i + 2);
      literal(end === -1 ? 2 : end + 2 - i);
      continue;
    }
    if (content.startsWith('((', i)) {
      const ref = matchAt(BLOCK_REF, content, i);
      if (ref !== null) {
        emit({ type: 'block-ref', uuid: ref[1]!, raw: ref[0] });
        continue;
      }
    }
    if (ch === '#' && (i === 0 || TAG_PREFIX.test(content[i - 1]!))) {
      if (content.startsWith('[[', i + 1)) {
        const end = closingBrackets(content, i + 1);
        const name = end === -1 ? '' : content.slice(i + 3, end - 2).trim();
        if (name !== '') {
          emit({ type: 'page-link', kind: 'tag', pageName: name, raw: content.slice(i, end) });
          continue;
        }
      } else {
        const tag = matchAt(TAG, content, i);
        if (tag !== null) {
          emit({ type: 'page-link', kind: 'tag', pageName: tag[1]!, raw: tag[0] });
          continue;
        }
      }
    }
    if (ch === '[' || (ch === '!' && content[i + 1] === '[')) {
      if (ch === '[') {
        const labeled = matchAt(LABELED_PAGE_REF, content, i);
        if (labeled !== null) {
          emit({ type: 'page-link', kind: 'ref', pageName: labeled[2]!.trim(), label: labeled[1]!, raw: labeled[0] });
          continue;
        }
      }
      const link = matchAt(MARKDOWN_LINK, content, i);
      if (link !== null) {
        const node = classifyMarkdownLink(link);
        if (node !== undefined) {
          emit(node);
        } else {
          literal(link[0].length);
        }
        continue;
      }
      if (content.startsWith('[[', i)) {
        const end = closingBrackets(content, i);
        const name = end === -1 ? '' : content.slice(i + 2, end - 2).trim();
        if (name !== '') {
          emit({ type: 'page-link', kind: 'ref', pageName: name, raw: content.slice(i, end) });
          continue;
        }
      }
    }
    literal(1);
  }

  if (text !== '') {
    nodes.push({ type: 'text', raw: text });
  }
  return { nodes };
}

export function serializePage(page: ParsedPage): string {
  return page.nodes.map((node) => node.raw).join('');
}

export function pageLinks(nodes: readonly PageNode[]): PageLinkNode[] {
  return nodes.filter((n): n is PageLinkNode => n.type === 'page-link');
}
