import { describe, expect, it } from 'vitest';
import { baseName, isAbsolutePath, isSamePath, normalizePath } from '../src/fs/paths';
import { LogseqUrlLinkRenderer, renderLink } from '../src/rendering/linkRenderer';
import { parsePage } from '../src/parsing/pageParser';

describe('paths', () => {
  it('normalizes separators and trailing slashes', () => {
    expect(normalizePath('C:\\a\\\\b\\')).toBe('C:/a/b');
    expect(normalizePath('/')).toBe('/');
    expect(normalizePath('\\\\server\\share\\')).toBe('//server/share');
  });

  it('detects absolute paths', () => {
    expect(isAbsolutePath('/home/x')).toBe(true);
    expect(isAbsolutePath('D:\\x')).toBe(true);
    expect(isAbsolutePath('\\\\server\\share')).toBe(true);
    expect(isAbsolutePath('relative/x')).toBe(false);
    expect(isAbsolutePath('C:relative')).toBe(false);
  });

  it('compares paths case-insensitively', () => {
    expect(isSamePath('C:/Graphs/A', 'c:\\graphs\\a\\')).toBe(true);
    expect(isSamePath('C:/Graphs/A', 'D:/Graphs/A')).toBe(false);
  });

  it('extracts the base name', () => {
    expect(baseName('D:/My Graphs/Graph B/')).toBe('Graph B');
    expect(baseName('graph')).toBe('graph');
  });
});

describe('renderLink', () => {
  const renderer = new LogseqUrlLinkRenderer();
  const a = { name: 'Graph A', path: '/g/A' };
  const b = { name: 'Graph B', path: '/g/B' };

  it('renders local links within the same graph', () => {
    expect(renderLink(renderer, a, { pageName: 'Ns/Page', kind: 'ref' }, a)).toBe('[[Ns/Page]]');
    expect(renderLink(renderer, a, { pageName: 'P', kind: 'ref', label: 'label' }, a)).toBe('[label]([[P]])');
    expect(renderLink(renderer, a, { pageName: 'tag', kind: 'tag' }, a)).toBe('#tag');
    expect(renderLink(renderer, a, { pageName: 'Two words', kind: 'tag' }, a)).toBe('#[[Two words]]');
    expect(renderLink(renderer, a, { pageName: 'E', kind: 'embed' }, a)).toBe('{{embed [[E]]}}');
  });

  it('renders encoded external links across graphs', () => {
    expect(renderLink(renderer, a, { pageName: 'Café, ok? (x)', kind: 'ref' }, b)).toBe(
      '[Café, ok? (x)](logseq://graph/Graph%20B?page=Caf%C3%A9%2C%20ok%3F%20%28x%29)',
    );
    expect(renderLink(renderer, a, { pageName: 'P', kind: 'ref', label: 'see' }, b)).toBe('[see](logseq://graph/Graph%20B?page=P)');
    expect(renderLink(renderer, a, { pageName: 'Two words', kind: 'tag' }, b)).toBe(
      '[#Two words](logseq://graph/Graph%20B?page=Two%20words)',
    );
    expect(renderLink(renderer, a, { pageName: 'E', kind: 'embed' }, b)).toBe('[E](logseq://graph/Graph%20B?page=E&embed=true)');
  });

  it.each([
    { pageName: 'Ns/Deep/Ünï (1)', kind: 'ref' as const },
    { pageName: 'P', kind: 'ref' as const, label: 'custom label' },
    { pageName: 'tag', kind: 'tag' as const },
    { pageName: 'Multi word', kind: 'tag' as const },
    { pageName: 'Emb', kind: 'embed' as const },
  ])('round-trips %j through the parser in both forms', (spec) => {
    for (const rendered of [renderer.renderLocal(spec), renderer.renderExternal(spec, b)]) {
      const [node] = parsePage(rendered).nodes;
      expect(node).toMatchObject({ type: 'page-link', pageName: spec.pageName, kind: spec.kind, raw: rendered });
      expect(node?.type === 'page-link' ? node.label : undefined).toBe(spec.label);
    }
  });
});
