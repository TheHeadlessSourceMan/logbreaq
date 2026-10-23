import { describe, expect, it } from 'vitest';
import { LocationIndex, loadLocationIndex, updatePageLocationIndex } from '../src/indexing/pageLocationIndex';
import { GRAPH_A, GRAPH_B, GRAPH_C, makeContext, makeDeps, makeRequest, runThrough, runUntil, seedGraph, writeFile } from './support/fixtures';
import { MemoryFileSystem } from './support/memoryFileSystem';

const INDEX_A = '/graphs/GraphA/logseq/graph-splitter/page-locations.json';
const INDEX_B = '/graphs/GraphB/logseq/graph-splitter/page-locations.json';

describe('LocationIndex', () => {
  it('round-trips through JSON', () => {
    const index = new LocationIndex();
    index.setGraphPages(GRAPH_B, ['Z', 'Y']);
    index.setGraphPages(GRAPH_A, ['X']);
    const json = index.toJSON();
    expect(json).toEqual({
      version: 1,
      graphs: [
        { name: 'GraphA', path: '/graphs/GraphA', pages: ['X'] },
        { name: 'GraphB', path: '/graphs/GraphB', pages: ['Y', 'Z'] },
      ],
    });
    expect(LocationIndex.fromJSON(JSON.parse(JSON.stringify(json))).toJSON()).toEqual(json);
  });

  it.each([null, {}, { version: 2, graphs: [] }, { version: 1, graphs: [{ name: 1 }] }])('rejects malformed data %j', (data) => {
    expect(() => LocationIndex.fromJSON(data)).toThrow();
  });

  it('moves pages and represents duplicate names across graphs', () => {
    const index = new LocationIndex();
    index.setGraphPages(GRAPH_A, ['Notes', 'X']);
    index.setGraphPages(GRAPH_B, ['notes']);
    index.movePage(GRAPH_A, GRAPH_B, 'x', 'X renamed');
    expect(index.has(GRAPH_A, 'X')).toBe(false);
    expect(index.has(GRAPH_B, 'x RENAMED')).toBe(true);
    expect(index.graphsContaining('NOTES').map((g) => g.name)).toEqual(['GraphA', 'GraphB']);
    expect(() => index.movePage(GRAPH_A, GRAPH_B, 'Ghost', 'Ghost')).toThrow(/not indexed/);
  });

  it('merges without overwriting known graphs', () => {
    const index = new LocationIndex();
    index.setGraphPages(GRAPH_A, ['Fresh']);
    const other = new LocationIndex();
    other.setGraphPages(GRAPH_A, ['Stale']);
    other.setGraphPages(GRAPH_C, ['C1']);
    index.merge(other);
    expect(index.has(GRAPH_A, 'Fresh')).toBe(true);
    expect(index.has(GRAPH_A, 'Stale')).toBe(false);
    expect(index.knownGraphs().map((g) => g.name)).toEqual(['GraphA', 'GraphC']);
  });
});

describe('loadLocationIndex', () => {
  async function setup(extra: (fs: MemoryFileSystem) => Promise<void> = async () => undefined) {
    const fs = new MemoryFileSystem();
    await seedGraph(fs, GRAPH_A, { pages: { 'X.md': '- [[Y]]', 'Y.md': '' } });
    await extra(fs);
    const ctx = makeContext(makeRequest(['X']), makeDeps(fs));
    await runUntil(ctx, 'load-location-index');
    return ctx;
  }

  it('builds the index from the scanned graphs when none is persisted', async () => {
    const ctx = await setup();
    await loadLocationIndex(ctx);
    expect(ctx.state.locationIndex!.toJSON().graphs.map((g) => [g.name, g.pages])).toEqual([
      ['GraphA', ['X', 'Y']],
      ['GraphB', []],
    ]);
    expect(ctx.state.existingIndexFiles).toEqual([]);
  });

  it('scans other graphs known from a persisted index and warns about missing ones', async () => {
    const ctx = await setup(async (fs) => {
      await seedGraph(fs, GRAPH_C, { pages: { 'C1.md': '- [Y](logseq://graph/GraphA?page=Y)' } });
      const persisted = { version: 1, graphs: [{ ...GRAPH_C, pages: [] }, { name: 'Gone', path: '/graphs/Gone', pages: ['G'] }] };
      await writeFile(fs, INDEX_A, JSON.stringify(persisted));
    });
    await loadLocationIndex(ctx);
    expect(ctx.state.existingIndexFiles).toEqual([INDEX_A]);
    expect(ctx.state.graphs.size).toBe(3);
    expect(ctx.state.locationIndex!.has(GRAPH_C, 'C1')).toBe(true);
    expect(ctx.state.warnings).toEqual([expect.stringMatching(/"Gone" was not found/)]);
  });

  it('ignores an unreadable index with a warning', async () => {
    const ctx = await setup((fs) => writeFile(fs, INDEX_A, '{not json'));
    await loadLocationIndex(ctx);
    expect(ctx.state.warnings[0]).toMatch(/Ignoring unreadable/);
    expect(ctx.state.existingIndexFiles).toEqual([INDEX_A]);
  });

  it('aborts when another known graph has the target graph name', async () => {
    const twin = { name: 'GraphB', path: '/other/GraphB' };
    const ctx = await setup(async (fs) => {
      await seedGraph(fs, twin);
      await writeFile(fs, INDEX_A, JSON.stringify({ version: 1, graphs: [{ ...twin, pages: [] }] }));
    });
    await expect(loadLocationIndex(ctx)).rejects.toThrow(/Several graphs are named "GraphB"/);
  });
});

describe('step 5: updatePageLocationIndex', () => {
  it('records the move and writes the index into both graphs', async () => {
    const fs = new MemoryFileSystem();
    await seedGraph(fs, GRAPH_A, { pages: { 'X.md': '', 'Y.md': '' } });
    const ctx = makeContext(makeRequest(['X']), makeDeps(fs));
    await runThrough(ctx, 'update-location-index');

    for (const path of [INDEX_A, INDEX_B]) {
      const written = JSON.parse(fs.text(path)) as { graphs: { name: string; pages: string[] }[] };
      expect(written.graphs.map((g) => [g.name, g.pages])).toEqual([
        ['GraphA', ['Y']],
        ['GraphB', ['X']],
      ]);
      expect(ctx.state.createdFiles.has(path)).toBe(true);
    }
  });

  it('replaces an existing index only after it was backed up', async () => {
    const fs = new MemoryFileSystem();
    await seedGraph(fs, GRAPH_A, { pages: { 'X.md': '' } });
    await writeFile(fs, INDEX_A, JSON.stringify({ version: 1, graphs: [] }));
    const ctx = makeContext(makeRequest(['X']), makeDeps(fs));
    await runThrough(ctx, 'update-location-index');
    expect(ctx.state.snapshot!.entries.map((e) => e.originalPath)).toContain(INDEX_A);
    expect(ctx.state.createdFiles.has(INDEX_A)).toBe(false);
    expect(fs.text(INDEX_A)).toContain('"X"');
  });

  it('requires the index to be loaded', async () => {
    const ctx = makeContext(makeRequest(['X']), makeDeps(new MemoryFileSystem()));
    await expect(updatePageLocationIndex(ctx)).rejects.toThrow(/not been loaded/);
  });
});
