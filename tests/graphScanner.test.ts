import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../src/fs/hash';
import { graphId, resolvePageKey, scanGraph } from '../src/indexing/graphScanner';
import { DEFAULT_GRAPH_LAYOUT } from '../src/model/types';
import { GRAPH_A, seedGraph } from './support/fixtures';
import { MemoryFileSystem } from './support/memoryFileSystem';

describe('scanGraph', () => {
  it('reads pages, journals, titles and aliases', async () => {
    const fs = new MemoryFileSystem();
    await seedGraph(fs, GRAPH_A, {
      pages: {
        'Plain.md': '- [[Other]]',
        'Ns___Child.md': '- child',
        'file-name.md': 'title:: Real Title\nalias:: Nick, [[Other Nick]]\n\n- body',
        'notes.org': '* org page',
      },
      journals: { '2026_10_22.md': '- today', 'odd.md': '- odd' },
    });

    const graph = await scanGraph(fs, GRAPH_A, DEFAULT_GRAPH_LAYOUT);

    expect(graph.id).toBe(graphId('/graphs/graphA/'));
    expect([...graph.pages.values()].map((p) => [p.name, p.folder]).sort()).toEqual([
      ['Ns/Child', 'pages'],
      ['Oct 22nd, 2026', 'journals'],
      ['Plain', 'pages'],
      ['Real Title', 'pages'],
      ['odd', 'journals'],
    ]);
    expect(graph.unsupportedFiles).toEqual(['/graphs/GraphA/pages/notes.org']);
    const titled = graph.pages.get('real title')!;
    expect(titled.fileName).toBe('file-name.md');
    expect(titled.aliases).toEqual(['Nick', 'Other Nick']);
    expect(titled.sha256).toBe(await sha256Hex(titled.content));
    expect(resolvePageKey(graph, 'NICK')).toBe('real title');
    expect(resolvePageKey(graph, 'other nick')).toBe('real title');
    expect(resolvePageKey(graph, 'plain')).toBe('plain');
    expect(resolvePageKey(graph, 'missing')).toBeUndefined();
  });

  it('reports duplicate page names and never lets an alias shadow a page', async () => {
    const fs = new MemoryFileSystem();
    await seedGraph(fs, GRAPH_A, {
      pages: { 'a.md': 'alias:: B', 'B.md': '- b', 'A-copy.md': 'title:: a\n- dup' },
    });

    const graph = await scanGraph(fs, GRAPH_A, DEFAULT_GRAPH_LAYOUT);

    expect(graph.duplicates.map((g) => g.map((p) => p.fileName))).toEqual([['A-copy.md', 'a.md']]);
    expect(resolvePageKey(graph, 'b')).toBe('b');
  });

  it('tolerates graphs without page folders and honours a custom journal format', async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir('/graphs/GraphA/journals');
    await fs.writeBytes('/graphs/GraphA/journals/2026_01_02.md', new TextEncoder().encode('- x'), { overwrite: false });

    const graph = await scanGraph(fs, GRAPH_A, { ...DEFAULT_GRAPH_LAYOUT, pagesDir: 'missing', journalTitleFormat: 'yyyy-MM-dd' });

    expect([...graph.pages.keys()]).toEqual(['2026-01-02']);
  });

  it('fails on files that are not valid UTF-8', async () => {
    const fs = new MemoryFileSystem();
    await seedGraph(fs, GRAPH_A, { pages: { 'bad.md': new Uint8Array([0xff]) } });
    await expect(scanGraph(fs, GRAPH_A, DEFAULT_GRAPH_LAYOUT)).rejects.toThrow();
  });
});
