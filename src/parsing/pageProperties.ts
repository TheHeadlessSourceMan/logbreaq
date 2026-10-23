import { parsePage } from './pageParser';

const PROPERTY_LINE = /^([A-Za-z0-9_-]+)::(?:[ \t]+(.*))?$/;

/** Page-level properties: the leading `key:: value` lines of a Markdown page. Keys are lower-cased. */
export function extractPageProperties(content: string): Map<string, string> {
  const properties = new Map<string, string>();
  for (const line of content.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const match = PROPERTY_LINE.exec(line);
    if (match === null) {
      break;
    }
    properties.set(match[1]!.toLowerCase(), (match[2] ?? '').trim());
  }
  return properties;
}

/** Splits a property value such as `a, [[b, c]], #d` into page names. */
export function parsePropertyValues(value: string): string[] {
  const values: string[] = [];
  for (const node of parsePage(value).nodes) {
    if (node.type === 'page-link') {
      values.push(node.pageName);
    } else if (node.type === 'text') {
      values.push(...node.raw.split(',').map((s) => s.trim()).filter((s) => s !== ''));
    }
  }
  return values;
}

/** Replaces the value of a leading `title::` property, preserving line endings. Returns content unchanged if absent. */
export function replaceTitleProperty(content: string, newTitle: string): string {
  const bom = content.startsWith('\uFEFF') ? '\uFEFF' : '';
  const parts = content.slice(bom.length).split(/(\r?\n)/);
  for (let i = 0; i < parts.length; i += 2) {
    const match = PROPERTY_LINE.exec(parts[i]!);
    if (match === null) {
      break;
    }
    if (match[1]!.toLowerCase() === 'title') {
      parts[i] = `${match[1]!}:: ${newTitle}`;
      return bom + parts.join('');
    }
  }
  return content;
}
