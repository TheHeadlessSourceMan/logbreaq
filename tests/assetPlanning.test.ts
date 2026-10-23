import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../src/fs/hash';
import {
  assetReferences,
  assetRelName,
  buildAssetUsageIndex,
  findExistingAsset,
  planAssetMigration,
  uniqueAssetName,
} from '../src/indexing/assetUsageIndex';
import { parsePage } from '../src/parsing/pageParser';
import { GRAPH_A, GRAPH_B, makeContext, makeDeps, makeRequest, runUntil, seedGraph, type GraphSeed } from './support/fixtures';
import { MemoryFileSystem } from './support/memoryFileSystem';

describe('asset helpers', () => {
  it.each([
    ['../assets/a.png', 'a.png'],
    ['assets/sub/my%20file.pdf', 'sub/my file.pdf'],
    ['./assets/x.png?v=1#frag', 'x.png'],
    ['/assets/bad%E0.png', 'bad%E0.png'],
  ])('relative name of %s is %s', (path, rel) => {
    expect(assetRelName(path)).toBe(rel);
  });

  it('lists asset references of a page', () => {
    const refs = assetReferences(parsePage('![a](../assets/a.png) [[P]] [b](assets/b.pdf)').nodes);
    expect(refs.map((r) => r.relName)).toEqual(['a.png', 'b.pdf']);
  });

  it('builds deterministic unique names', () => {
    expect(uniqueAssetName('dir/pic.png', 'abcdef0123', 0)).toBe('dir/pic_abcdef01.png');
    expect(uniqueAssetName('README', 'abcdef0123', 1)).toBe('README_abcdef01_2');
  });

  it('finds assets in subfolders, preferring exact case', async () => {
    const fs = new MemoryFileSystem();
    await seedGraph(fs, GRAPH_A, { assets: { 'sub/Pic.png': '1', 'sub/pic.png': '2', 'dir/x': '3' } });
    const dir = '/graphs/GraphA/assets';
    expect(await findExistingAsset(fs, dir, 'sub/pic.png')).toBe('sub/pic.png');
    expect(await findExistingAsset(fs, dir, 'SUB/PIC.PNG')).toBe('sub/Pic.png');
    expect(await findExistingAsset(fs, dir, 'sub')).toBeUndefined();
    expect(await findExistingAsset(fs, dir, 'none/x')).toBeUndefined();
    expect(await findExistingAsset(fs, dir, 'dir/x/deeper')).toBeUndefined();
  });
});

describe('step 7: planAssetMigration', () => {
  async function plan(pages: string[], a: GraphSeed, b: GraphSeed = {}, caseSensitive = true) {
    const fs = new MemoryFileSystem(caseSensitive);
    await seedGraph(fs, GRAPH_A, a);
    await seedGraph(fs, GRAPH_B, b);
    const ctx = makeContext(makeRequest(pages), makeDeps(fs));
    await runUntil(ctx, 'plan-assets');
    await planAssetMigration(ctx);
    return ctx;
  }

  it('moves exclusively used assets and copies shared ones', async () => {
    const ctx = await plan(['X', 'Y'], {
      pages: {
        'X.md': '![a](../assets/only-x.png) ![s](../assets/shared.png) ![y](../assets/xy.png)',
        'Y.md': '![y](../assets/xy.png)',
        'Z.md': '![s](../assets/shared.png)',
      },
      assets: { 'only-x.png': 'o', 'shared.png': 's', 'xy.png': 'xy' },
    });
    expect(ctx.state.assetActions.map((a) => [a.asset, a.action, a.targetName])).toEqual([
      ['only-x.png', 'move', 'only-x.png'],
      ['shared.png', 'copy', 'shared.png'],
      ['xy.png', 'move', 'xy.png'],
    ]);
    expect(ctx.state.assetActions[0]!.targetPath).toBe('/graphs/GraphB/assets/only-x.png');
    expect(ctx.state.assetActions[0]!.sha256).toBe(await sha256Hex('o'));
    expect(ctx.state.resolvedConflicts).toEqual([]);
  });

  it('reuses an identical asset already in the target graph', async () => {
    const ctx = await plan(['X'], { pages: { 'X.md': '![a](../assets/pic.png)' }, assets: { 'pic.png': 'same' } }, { assets: { 'PIC.png': 'same' } });
    expect(ctx.state.assetActions.map((a) => [a.action, a.targetName])).toEqual([['reuse', 'PIC.png']]);
    expect(ctx.state.resolvedConflicts[0]?.resolution).toEqual({ kind: 'reuse-existing-asset' });
  });

  it('copies a differing asset under a hash-suffixed name', async () => {
    const ctx = await plan(['X'], { pages: { 'X.md': '![a](../assets/pic.png)' }, assets: { 'pic.png': 'new' } }, { assets: { 'Pic.png': 'old' } }, false);
    const expected = uniqueAssetName('pic.png', await sha256Hex('new'), 0);
    expect(ctx.state.assetActions.map((a) => [a.action, a.targetName])).toEqual([['move', expected]]);
    expect(ctx.state.resolvedConflicts).toEqual([
      {
        conflict: { kind: 'asset-name', subject: 'pic.png', existing: 'Pic.png', detail: 'Different content.' },
        resolution: { kind: 'copy-asset-as', newName: expected },
      },
    ]);
  });

  it('falls back to further suffixes, and reuses a matching suffixed copy', async () => {
    const sha = await sha256Hex('new');
    const first = uniqueAssetName('pic.png', sha, 0);
    const second = uniqueAssetName('pic.png', sha, 1);
    const clash = await plan(['X'], { pages: { 'X.md': '![a](../assets/pic.png)' }, assets: { 'pic.png': 'new' } }, { assets: { 'pic.png': 'old', [first]: 'other' } });
    expect(clash.state.assetActions[0]!.targetName).toBe(second);

    const reuse = await plan(['X'], { pages: { 'X.md': '![a](../assets/pic.png)' }, assets: { 'pic.png': 'new' } }, { assets: { 'pic.png': 'old', [first]: 'new' } });
    expect(reuse.state.assetActions.map((a) => [a.action, a.targetName])).toEqual([['reuse', first]]);
  });

  it('avoids collisions between assets planned in the same run', async () => {
    const ctx = await plan(['X'], { pages: { 'X.md': '![a](../assets/a.png) ![b](../assets/A.png)' }, assets: { 'a.png': '1', 'A.png': '2' } });
    const names = ctx.state.assetActions.map((a) => a.targetName.toLowerCase());
    expect(new Set(names).size).toBe(2);
  });

  it('skips missing assets and records nothing for them', async () => {
    const ctx = await plan(['X'], { pages: { 'X.md': '![a](../assets/gone.png)' } });
    expect(ctx.state.assetActions).toEqual([]);
    expect(ctx.state.missingAssets.has('gone.png')).toBe(true);
  });

  it('builds a case-insensitive usage index', async () => {
    const fs = new MemoryFileSystem();
    await seedGraph(fs, GRAPH_A, { pages: { 'X.md': '![a](../assets/Pic.png)', 'Y.md': '![a](../assets/pic.png)' } });
    const ctx = makeContext(makeRequest(['X']), makeDeps(fs));
    await runUntil(ctx, 'verify-source-graph');
    const usage = buildAssetUsageIndex(ctx.state.graphs.get(ctx.state.sourceId)!);
    expect([...usage.get('pic.png')!].sort()).toEqual(['x', 'y']);
  });
});
