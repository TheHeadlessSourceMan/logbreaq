import { describe, expect, it } from 'vitest';
import { FileAlreadyExistsError } from '../src/fs/fileSystem';
import { sha256Hex } from '../src/fs/hash';
import { transferAssets } from '../src/migration/assetReferences';
import { movePageFiles } from '../src/migration/pageFiles';
import type { ConflictResolver } from '../src/conflicts/conflictResolver';
import { GRAPH_A, GRAPH_B, assetPath, makeContext, makeDeps, makeRequest, pagePath, runUntil, seedGraph, writeFile, type GraphSeed } from './support/fixtures';
import { MemoryFileSystem } from './support/memoryFileSystem';

async function prepare(pages: string[], a: GraphSeed, b: GraphSeed = {}, conflictResolver?: ConflictResolver) {
  const fs = new MemoryFileSystem();
  await seedGraph(fs, GRAPH_A, a);
  await seedGraph(fs, GRAPH_B, b);
  const ctx = makeContext(makeRequest(pages), makeDeps(fs, conflictResolver ? { conflictResolver } : {}));
  await runUntil(ctx, 'move-pages');
  return { fs, ctx };
}

describe('step 8: movePageFiles', () => {
  it('copies page files byte-for-byte and defers removal of the originals', async () => {
    const content = '\uFEFFtitle:: Ünï/Name\n- [[Y]]\r\n';
    const { fs, ctx } = await prepare(['Ünï/Name'], { pages: { 'whatever.md': content, 'Y.md': '' } });
    await movePageFiles(ctx);

    const target = pagePath(GRAPH_B, 'whatever.md');
    expect(fs.text(target)).toBe(content);
    expect(fs.has(pagePath(GRAPH_A, 'whatever.md'))).toBe(true);
    expect(ctx.state.pendingRemovals).toEqual([pagePath(GRAPH_A, 'whatever.md')]);
    expect(ctx.state.filesMoved).toEqual([{ from: pagePath(GRAPH_A, 'whatever.md'), to: target, sha256: await sha256Hex(content) }]);
    expect(ctx.state.pagesMoved).toEqual(['Ünï/Name']);
    expect(ctx.state.createdFiles.get(target)).toBe(await sha256Hex(content));
  });

  it('writes renamed pages under the new file name and updates title::', async () => {
    const rename: ConflictResolver = {
      resolve: async (cs) =>
        cs.map((conflict) => ({ conflict, resolution: { kind: 'rename', newName: conflict.subject === 'X' ? 'X/From A' : 'T2' } })),
    };
    const { fs, ctx } = await prepare(['X', 'T'], { pages: { 'X.md': '- x', 'T.md': 'title:: T\n- t' } }, { pages: { 'X.md': '', 'T.md': '' } }, rename);
    await movePageFiles(ctx);
    expect(fs.text(pagePath(GRAPH_B, 'X___From A.md'))).toBe('- x');
    expect(fs.text(pagePath(GRAPH_B, 'T2.md'))).toBe('title:: T2\n- t');
    expect(fs.text(pagePath(GRAPH_B, 'T.md'))).toBe('');
    expect([...ctx.state.pagesMoved].sort()).toEqual(['T2', 'X/From A']);
  });

  it('never overwrites a file that appears in the target concurrently', async () => {
    const { fs, ctx } = await prepare(['X'], { pages: { 'X.md': '- x' } });
    await writeFile(fs, pagePath(GRAPH_B, 'X.md'), '- created by someone else');
    await expect(movePageFiles(ctx)).rejects.toBeInstanceOf(FileAlreadyExistsError);
    expect(fs.text(pagePath(GRAPH_B, 'X.md'))).toBe('- created by someone else');
  });

  it('aborts when the source page changed since it was scanned', async () => {
    const { fs, ctx } = await prepare(['X'], { pages: { 'X.md': '- x' } });
    await writeFile(fs, pagePath(GRAPH_A, 'X.md'), '- changed');
    await expect(movePageFiles(ctx)).rejects.toThrow(/modified by another program/);
  });

  it('detects a write that does not persist correctly', async () => {
    const { fs, ctx } = await prepare(['X'], { pages: { 'X.md': '- x' } });
    const original = fs.writeBytes.bind(fs);
    fs.writeBytes = async (path, data, options) => original(path, path.includes('GraphB/pages') ? new Uint8Array([1]) : data, options);
    await expect(movePageFiles(ctx)).rejects.toThrow(/does not match/);
    expect(ctx.state.createdFiles.has(pagePath(GRAPH_B, 'X.md'))).toBe(true);
  });
});

describe('step 8: transferAssets', () => {
  it('copies moved and shared assets, skips reused ones, and defers removal of moved originals', async () => {
    const { fs, ctx } = await prepare(
      ['X'],
      {
        pages: { 'X.md': '![m](../assets/m.png) ![s](../assets/s.png) ![r](../assets/r.png)', 'Y.md': '![s](../assets/s.png)' },
        assets: { 'm.png': 'move', 's.png': 'share', 'r.png': 'reuse' },
      },
      { assets: { 'r.png': 'reuse' } },
    );
    await movePageFiles(ctx);
    await transferAssets(ctx);

    expect(fs.text(assetPath(GRAPH_B, 'm.png'))).toBe('move');
    expect(fs.text(assetPath(GRAPH_B, 's.png'))).toBe('share');
    expect(ctx.state.createdFiles.has(assetPath(GRAPH_B, 'r.png'))).toBe(false);
    expect(ctx.state.pendingRemovals).toContain(assetPath(GRAPH_A, 'm.png'));
    expect(ctx.state.pendingRemovals).not.toContain(assetPath(GRAPH_A, 's.png'));
    expect(ctx.state.filesCopied.map((op) => op.from)).toEqual([assetPath(GRAPH_A, 's.png')]);
    expect(fs.has(assetPath(GRAPH_A, 'm.png'))).toBe(true);
  });

  it('aborts when an asset changed after planning', async () => {
    const { fs, ctx } = await prepare(['X'], { pages: { 'X.md': '![m](../assets/m.png)' }, assets: { 'm.png': 'v1' } });
    await writeFile(fs, assetPath(GRAPH_A, 'm.png'), 'v2');
    await expect(transferAssets(ctx)).rejects.toThrow(/modified by another program/);
  });
});
