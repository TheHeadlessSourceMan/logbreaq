import { describe, expect, it } from 'vitest';
import { buildBacklinkIndex, determineAffectedPages, identityKey } from '../src/indexing/backlinkIndex';
import { graphId } from '../src/indexing/graphScanner';
import { findGraphByName, resolveLinkTarget } from '../src/indexing/linkResolution';
import { GRAPH_A, GRAPH_B, GRAPH_C, makeContext, makeDeps, makeRequest, runUntil, seedGraph, writeFile } from './support/fixtures';
import { MemoryFileSystem } from './support/memoryFileSystem';

const A = graphId(GRAPH_A.path);
const B = graphId(GRAPH_B.path);
const C = graphId(GRAPH_C.path);

async function prepare(pages: string[]) {
  const fs = new MemoryFileSystem();
  await seedGraph(fs, GRAPH_A, {
    pages: {
      'X.md': 'alias:: Ex\n- [[Y]] [[X]]',
      'Y.md': '- [[X]] and [[Y]]',
      'P.md': '- via alias [[ex]]',
      'Q.md': '- #X',
      'Unrelated.md': '- [[Y]]',
    },
  });
  await seedGraph(fs, GRAPH_B, { pages: { 'B1.md': '- [x](logseq://graph/GraphA?page=X)', 'B2.md': '- [[X]]' } });
  await seedGraph(fs, GRAPH_C, { pages: { 'C1.md': '- [X](logseq://graph/graphA?page=X)', 'C2.md': '- [Q](logseq://graph/Unknown?page=X)' } });
  await writeFile(fs, '/graphs/GraphA/logseq/graph-splitter/page-locations.json', JSON.stringify({ version: 1, graphs: [{ ...GRAPH_C, pages: [] }] }));
  const ctx = makeContext(makeRequest(pages), makeDeps(fs));
  await runUntil(ctx, 'determine-affected-pages');
  return ctx;
}

describe('link resolution', () => {
  it('resolves local, alias, external and unknown links', async () => {
    const ctx = await prepare(['X']);
    const { graphs } = ctx.state;
    const link = (pageName: string, graphName?: string) => ({
      type: 'page-link' as const, kind: 'ref' as const, pageName, raw: '',
      ...(graphName !== undefined ? { external: { graphName } } : {}),
    });
    expect(resolveLinkTarget(graphs, A, link('EX'))).toEqual({ graphId: A, key: 'x', exists: true });
    expect(resolveLinkTarget(graphs, B, link('X'))).toEqual({ graphId: B, key: 'x', exists: false });
    expect(resolveLinkTarget(graphs, B, link('x', 'GRAPHA'))).toEqual({ graphId: A, key: 'x', exists: true });
    expect(resolveLinkTarget(graphs, B, link('x', 'Nowhere'))).toBeUndefined();
    expect(findGraphByName(graphs, 'graphc')?.id).toBe(C);
  });
});

describe('step 6: determineAffectedPages', () => {
  it('indexes backlinks across all scanned graphs', async () => {
    const ctx = await prepare(['X']);
    const backlinks = buildBacklinkIndex(ctx.state.graphs);
    expect([...backlinks.get(identityKey(A, 'x'))!.keys()].sort()).toEqual(
      [identityKey(A, 'p'), identityKey(A, 'q'), identityKey(A, 'x'), identityKey(A, 'y'), identityKey(B, 'b1'), identityKey(C, 'c1')].sort(),
    );
    expect([...backlinks.get(identityKey(B, 'x'))!.keys()]).toEqual([identityKey(B, 'b2')]);
  });

  it('includes the moved pages and every page linking to them', async () => {
    const ctx = await prepare(['X']);
    await determineAffectedPages(ctx);
    const affected = ctx.state.affectedPages.map((p) => `${p.graphId === A ? 'A' : p.graphId === B ? 'B' : 'C'}:${p.key}`);
    expect(affected.sort()).toEqual(['A:p', 'A:q', 'A:x', 'A:y', 'B:b1', 'C:c1']);
  });

  it('de-duplicates pages linking to several moved pages', async () => {
    const ctx = await prepare(['X', 'Y']);
    await determineAffectedPages(ctx);
    const keys = ctx.state.affectedPages.map((p) => `${p.graphId}:${p.key}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain(`${A}:unrelated`);
  });
});
