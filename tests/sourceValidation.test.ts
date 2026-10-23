import { describe, expect, it } from 'vitest';
import { MigrationAbortedError } from '../src/migration/migrationContext';
import { validateSourcePages, verifySourceGraphHealth } from '../src/validation/sourceValidation';
import { GRAPH_A, makeContext, makeDeps, makeRequest, pagePath, seedGraph, writeFile } from './support/fixtures';
import { MemoryFileSystem } from './support/memoryFileSystem';

async function setup(pages: string[], seed: Parameters<typeof seedGraph>[2]) {
  const fs = new MemoryFileSystem();
  await seedGraph(fs, GRAPH_A, seed);
  return { fs, ctx: makeContext(makeRequest(pages), makeDeps(fs)) };
}

describe('step 1: validateSourcePages', () => {
  it('scans the source graph and records the selection by page key', async () => {
    const { ctx } = await setup(['project a', 'Renamed'], {
      pages: { 'Project A.md': '- a', 'file.md': 'title:: Renamed\n- r' },
    });
    await validateSourcePages(ctx);
    expect([...ctx.state.selectedKeys].sort()).toEqual(['project a', 'renamed']);
    expect(ctx.state.fileHashes.get(pagePath(GRAPH_A, 'Project A.md'))).toMatch(/^[0-9a-f]{64}$/);
  });

  it('aborts on an empty selection', async () => {
    const { ctx } = await setup([], { pages: { 'X.md': '' } });
    await expect(validateSourcePages(ctx)).rejects.toThrow(/No pages were selected/);
  });

  it('aborts when the source graph folder is missing', async () => {
    const fs = new MemoryFileSystem();
    const ctx = makeContext(makeRequest(['X']), makeDeps(fs));
    await expect(validateSourcePages(ctx)).rejects.toThrow(/Source graph folder not found/);
  });

  it('aborts listing every missing page', async () => {
    const { ctx } = await setup(['X', 'Ghost', 'Phantom'], { pages: { 'X.md': '' } });
    await expect(validateSourcePages(ctx)).rejects.toThrow('Page(s) not found in the source graph: Ghost, Phantom');
  });

  it('refuses to move journal pages', async () => {
    const { ctx } = await setup(['Oct 22nd, 2026'], { journals: { '2026_10_22.md': '- j' } });
    await expect(validateSourcePages(ctx)).rejects.toBeInstanceOf(MigrationAbortedError);
  });
});

describe('step 2: verifySourceGraphHealth', () => {
  it('passes for a healthy graph', async () => {
    const { ctx } = await setup(['X'], { pages: { 'X.md': '![i](../assets/i.png)' }, assets: { 'i.png': 'img' } });
    await validateSourcePages(ctx);
    await verifySourceGraphHealth(ctx);
    expect(ctx.state.warnings).toEqual([]);
  });

  it('aborts when a selected page is defined by several files, warns for others', async () => {
    const seed = { pages: { 'X.md': '', 'x-copy.md': 'title:: x\n', 'Y.md': '', 'y2.md': 'title:: Y\n' } };
    const { ctx } = await setup(['Y'], seed);
    await validateSourcePages(ctx);
    await expect(verifySourceGraphHealth(ctx)).rejects.toThrow(/defined by several files/);

    const other = await setup(['Z'], { pages: { ...seed.pages, 'Z.md': '' } });
    await validateSourcePages(other.ctx);
    await verifySourceGraphHealth(other.ctx);
    expect(other.ctx.state.warnings).toHaveLength(2);
  });

  it('detects a page modified after it was scanned', async () => {
    const { fs, ctx } = await setup(['X'], { pages: { 'X.md': 'original' } });
    await validateSourcePages(ctx);
    await writeFile(fs, pagePath(GRAPH_A, 'X.md'), 'edited elsewhere');
    await expect(verifySourceGraphHealth(ctx)).rejects.toThrow(/modified by another program/);
  });

  it('aborts when a page file disappears', async () => {
    const { fs, ctx } = await setup(['X'], { pages: { 'X.md': 'x' } });
    await validateSourcePages(ctx);
    await fs.remove(pagePath(GRAPH_A, 'X.md'));
    await expect(verifySourceGraphHealth(ctx)).rejects.toThrow(/disappeared/);
  });

  it('aborts when assets are referenced but the assets folder is missing', async () => {
    const fs = new MemoryFileSystem();
    await writeFile(fs, pagePath(GRAPH_A, 'X.md'), '![i](../assets/i.png)');
    const ctx = makeContext(makeRequest(['X']), makeDeps(fs));
    await validateSourcePages(ctx);
    await expect(verifySourceGraphHealth(ctx)).rejects.toThrow(/does not exist/);
  });

  it('aborts when the pages folder is missing', async () => {
    const fs = new MemoryFileSystem();
    await writeFile(fs, '/graphs/GraphA/journals/2026_10_22.md', '- j');
    const ctx = makeContext(makeRequest(['X']), makeDeps(fs));
    ctx.state.graphs.set(ctx.state.sourceId, {
      graph: GRAPH_A, id: ctx.state.sourceId, pages: new Map(), aliases: new Map(), duplicates: [], unsupportedFiles: [],
    });
    await expect(verifySourceGraphHealth(ctx)).rejects.toThrow(/Pages folder missing/);
  });

  it('warns once per missing asset and remembers it as pre-existing', async () => {
    const { ctx } = await setup(['X', 'Y'], {
      pages: { 'X.md': '![a](../assets/gone.png)', 'Y.md': '![b](../assets/Gone.png)' },
    });
    await validateSourcePages(ctx);
    await verifySourceGraphHealth(ctx);
    expect(ctx.state.warnings).toHaveLength(1);
    expect([...ctx.state.missingAssets]).toEqual(['gone.png']);
  });
});
