import { describe, expect, it } from 'vitest';
import { baseName, isAbsolutePath, isSamePath, normalizePath } from '../src/fs/paths';
import { LogseqUrlLinkRenderer, renderLink } from '../src/rendering/linkRenderer';

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
    expect(renderLink(renderer, a, { pageName: 'Ns/Page', graph: a })).toBe('[[Ns/Page]]');
    expect(renderLink(renderer, a, { pageName: 'P', graph: a }, 'label')).toBe('[label]([[P]])');
  });

  it('renders encoded external links across graphs', () => {
    expect(renderLink(renderer, a, { pageName: 'Café, ok?', graph: b })).toBe(
      '[Café, ok?](logseq://graph/Graph%20B?page=Caf%C3%A9%2C%20ok%3F)',
    );
    expect(renderLink(renderer, a, { pageName: 'P', graph: b }, 'see')).toBe('[see](logseq://graph/Graph%20B?page=P)');
  });
});
