import { describe, expect, it } from 'vitest';
import { pageLinks, parseLogseqPageUrl, parsePage, serializePage, type PageNode } from '../src/parsing/pageParser';

function nonText(content: string): PageNode[] {
  return parsePage(content).nodes.filter((n) => n.type !== 'text');
}

describe('parsePage', () => {
  it('round-trips arbitrary content losslessly', () => {
    const samples = [
      '',
      'plain text\nwith lines\r\n',
      '- [[A]] and #tag and #[[Multi word]] {{embed [[E]]}} [l]([[P]]) ((6523e5a0-1111-2222-3333-444455556666))',
      '- unbalanced [[ and ]] and [x]( and {{ and `code [[no]]`',
      '```\n[[inside fence]]\n```\n[[after]]',
      '![img](../assets/a.png "cap") [doc](assets/b.pdf) [web](https://x.y/#z)',
      '[Ext](logseq://graph/G?page=P) [#t](logseq://graph/G?page=t) [E](logseq://graph/G?page=E&embed=true)',
    ];
    for (const sample of samples) {
      expect(serializePage(parsePage(sample))).toBe(sample);
    }
  });

  it('parses local page references, including namespaces, unicode and nesting', () => {
    const links = pageLinks(parsePage('[[Ns/Child]] [[Ünï 日本]] [[a [[b]] c]] [[  spaced  ]]').nodes);
    expect(links.map((l) => [l.kind, l.pageName])).toEqual([
      ['ref', 'Ns/Child'],
      ['ref', 'Ünï 日本'],
      ['ref', 'a [[b]] c'],
      ['ref', 'spaced'],
    ]);
  });

  it('parses tags only at word boundaries', () => {
    const links = pageLinks(parsePage('#one (#two) x#no http://a/#no #end. # heading ##x #[[Big Tag]]').nodes);
    expect(links.map((l) => [l.kind, l.pageName, l.raw])).toEqual([
      ['tag', 'one', '#one'],
      ['tag', 'two', '#two'],
      ['tag', 'end', '#end'],
      ['tag', 'Big Tag', '#[[Big Tag]]'],
    ]);
  });

  it('parses embeds and labeled references', () => {
    expect(nonText('{{embed [[Page (x)]]}} [see this]([[Target]])')).toEqual([
      { type: 'page-link', kind: 'embed', pageName: 'Page (x)', raw: '{{embed [[Page (x)]]}}' },
      { type: 'page-link', kind: 'ref', pageName: 'Target', label: 'see this', raw: '[see this]([[Target]])' },
    ]);
  });

  it('ignores links inside code and other macros', () => {
    expect(nonText('`[[a]]` ```\n#b\n``` {{query [[c]]}}')).toEqual([]);
  });

  it('parses external logseq links back into page links', () => {
    expect(nonText('[P](logseq://graph/Graph%20B?page=P) [lbl](logseq://graph/B?page=P) [#t](logseq://graph/B?page=t) [x](logseq://graph/B?page=Q&embed=true)')).toEqual([
      { type: 'page-link', kind: 'ref', pageName: 'P', external: { graphName: 'Graph B' }, raw: '[P](logseq://graph/Graph%20B?page=P)' },
      { type: 'page-link', kind: 'ref', pageName: 'P', label: 'lbl', external: { graphName: 'B' }, raw: '[lbl](logseq://graph/B?page=P)' },
      { type: 'page-link', kind: 'tag', pageName: 't', external: { graphName: 'B' }, raw: '[#t](logseq://graph/B?page=t)' },
      { type: 'page-link', kind: 'embed', pageName: 'Q', external: { graphName: 'B' }, raw: '[x](logseq://graph/B?page=Q&embed=true)' },
    ]);
  });

  it('parses asset links and leaves other links as text', () => {
    expect(nonText('![a b](../assets/x.png "t") [f](<assets/my file.pdf>) [w](https://e.com/assets/x.png)')).toEqual([
      { type: 'asset', isEmbed: true, label: 'a b', path: '../assets/x.png', title: ' "t"', raw: '![a b](../assets/x.png "t")' },
      { type: 'asset', isEmbed: false, label: 'f', path: 'assets/my file.pdf', title: '', raw: '[f](<assets/my file.pdf>)' },
    ]);
  });

  it('parses block references', () => {
    expect(nonText('((6523e5a0-1111-2222-3333-444455556666)) ((not-a-uuid))')).toEqual([
      { type: 'block-ref', uuid: '6523e5a0-1111-2222-3333-444455556666', raw: '((6523e5a0-1111-2222-3333-444455556666))' },
    ]);
  });

  it('handles pages with thousands of links', () => {
    const content = Array.from({ length: 5000 }, (_, i) => `- [[Page ${i}]] #t${i}`).join('\n');
    const parsed = parsePage(content);
    expect(pageLinks(parsed.nodes)).toHaveLength(10000);
    expect(serializePage(parsed)).toBe(content);
  });
});

describe('parseLogseqPageUrl', () => {
  it('rejects non-page logseq URLs', () => {
    expect(parseLogseqPageUrl('logseq://graph/G?block-id=x')).toBeUndefined();
    expect(parseLogseqPageUrl('https://x?page=y')).toBeUndefined();
  });

  it('keeps undecodable graph names verbatim', () => {
    expect(parseLogseqPageUrl('logseq://graph/%E0?page=P')?.graphName).toBe('%E0');
  });
});
