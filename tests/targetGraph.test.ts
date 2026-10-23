import { describe, expect, it } from 'vitest';
import { ensureTargetGraph } from '../src/migration/targetGraph';
import { GRAPH_A, GRAPH_B, makeContext, makeDeps, makeRequest, pagePath, seedGraph, writeFile } from './support/fixtures';
import { MemoryFileSystem } from './support/memoryFileSystem';

async function setup() {
  const fs = new MemoryFileSystem();
  await seedGraph(fs, GRAPH_A, { pages: { 'X.md': '- x' } });
  return fs;
}

describe('step 3: ensureTargetGraph', () => {
  it('creates a missing target graph with all required folders', async () => {
    const fs = await setup();
    const ctx = makeContext(makeRequest(['X']), makeDeps(fs));
    await ensureTargetGraph(ctx);
    expect(ctx.state.targetGraphCreated).toBe(true);
    for (const dir of ['pages', 'journals', 'assets', 'logseq']) {
      expect(await fs.isDirectory(`${GRAPH_B.path}/${dir}`)).toBe(true);
    }
    expect(ctx.state.graphs.get(ctx.state.targetId)?.pages.size).toBe(0);
  });

  it('uses an existing graph without modifying it and adds only missing folders', async () => {
    const fs = await setup();
    await writeFile(fs, pagePath(GRAPH_B, 'Existing.md'), '- keep me');
    const ctx = makeContext(makeRequest(['X']), makeDeps(fs));
    await ensureTargetGraph(ctx);
    expect(ctx.state.targetGraphCreated).toBe(false);
    expect(fs.text(pagePath(GRAPH_B, 'Existing.md'))).toBe('- keep me');
    expect(await fs.isDirectory(`${GRAPH_B.path}/assets`)).toBe(true);
    expect([...ctx.state.graphs.get(ctx.state.targetId)!.pages.keys()]).toEqual(['existing']);
    expect(ctx.state.fileHashes.has(pagePath(GRAPH_B, 'Existing.md'))).toBe(true);
  });

  it('accepts an existing empty folder', async () => {
    const fs = await setup();
    await fs.mkdir(GRAPH_B.path);
    const ctx = makeContext(makeRequest(['X']), makeDeps(fs));
    await ensureTargetGraph(ctx);
    expect(ctx.state.targetGraphCreated).toBe(false);
  });

  it('rejects a non-empty folder that is not a graph', async () => {
    const fs = await setup();
    await writeFile(fs, `${GRAPH_B.path}/tax-return.pdf`, 'private');
    await expect(ensureTargetGraph(makeContext(makeRequest(['X']), makeDeps(fs)))).rejects.toThrow(/not a Logseq graph/);
    expect(await fs.exists(`${GRAPH_B.path}/pages`)).toBe(false);
  });

  it('rejects a target that is a file, or contains a file where a folder is required', async () => {
    const fs = await setup();
    await writeFile(fs, GRAPH_B.path, 'file');
    await expect(ensureTargetGraph(makeContext(makeRequest(['X']), makeDeps(fs)))).rejects.toThrow(/is a file/);

    const fs2 = await setup();
    await fs2.mkdir(`${GRAPH_B.path}/pages`);
    await writeFile(fs2, `${GRAPH_B.path}/assets`, 'oops');
    await expect(ensureTargetGraph(makeContext(makeRequest(['X']), makeDeps(fs2)))).rejects.toThrow(/found a file/);
  });

  it('rejects the source graph or a graph with the same name', async () => {
    const fs = await setup();
    const same = makeRequest(['X'], { targetGraph: { name: 'Other', path: '/graphs/grapha/' } });
    await expect(ensureTargetGraph(makeContext(same, makeDeps(fs)))).rejects.toThrow(/must differ/);
    const sameName = makeRequest(['X'], { targetGraph: { name: 'graphA', path: '/elsewhere/graphA' } });
    await expect(ensureTargetGraph(makeContext(sameName, makeDeps(fs)))).rejects.toThrow(/both named/);
  });
});
