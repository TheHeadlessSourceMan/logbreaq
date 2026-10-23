import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../src/fs/hash';
import { uniqueAssetName } from '../src/indexing/assetUsageIndex';
import { findAssetAction, rewriteAssetReferences } from '../src/migration/assetReferences';
import { IntegrityError } from '../src/migration/migrationContext';
import type { AssetAction } from '../src/model/types';
import { GRAPH_A, GRAPH_B, assetPath, makeContext, makeDeps, makeRequest, pagePath, runThrough, runUntil, seedGraph } from './support/fixtures';
import { MemoryFileSystem } from './support/memoryFileSystem';

describe('findAssetAction', () => {
  const action = (asset: string): AssetAction => ({ asset, sourcePath: '', action: 'copy', targetName: asset, targetPath: '', sha256: '' });

  it('prefers exact matches, then case-insensitive ones', () => {
    const actions = [action('Pic.png'), action('pic.png')];
    expect(findAssetAction(actions, 'pic.png')).toBe(actions[1]);
    expect(findAssetAction(actions, 'PIC.PNG')).toBe(actions[0]);
    expect(findAssetAction(actions, 'other.png')).toBeUndefined();
  });
});

describe('step 11: rewriteAssetReferences', () => {
  it('points references at renamed assets and normalizes paths', async () => {
    const fs = new MemoryFileSystem();
    await seedGraph(fs, GRAPH_A, {
      pages: {
        'X.md': '- ![a](../assets/a.png "cap") [doc](assets/my%20doc.pdf) ![k](../assets/keep.png) ![g](../assets/gone.png) [[a.png]]',
      },
      assets: { 'a.png': 'new', 'my doc.pdf': 'pdf', 'keep.png': 'k' },
    });
    await seedGraph(fs, GRAPH_B, { assets: { 'a.png': 'old' } });
    const ctx = makeContext(makeRequest(['X']), makeDeps(fs));
    await runThrough(ctx, 'rewrite-assets');

    const renamed = uniqueAssetName('a.png', await sha256Hex('new'), 0);
    expect(fs.text(pagePath(GRAPH_B, 'X.md'))).toBe(
      `- ![a](../assets/${renamed} "cap") [doc](../assets/my%20doc.pdf) ![k](../assets/keep.png) ![g](../assets/gone.png) [[a.png]]`,
    );
    expect(fs.text(assetPath(GRAPH_B, renamed))).toBe('new');
    expect(fs.text(assetPath(GRAPH_B, 'a.png'))).toBe('old');
    expect(ctx.state.linksRewritten.filter((r) => r.before.includes('assets'))).toHaveLength(2);
  });

  it('leaves pages without asset changes untouched', async () => {
    const fs = new MemoryFileSystem();
    await seedGraph(fs, GRAPH_A, { pages: { 'X.md': '- ![k](../assets/k.png)' }, assets: { 'k.png': 'k' } });
    const ctx = makeContext(makeRequest(['X']), makeDeps(fs));
    await runThrough(ctx, 'rewrite-assets');
    expect(fs.text(pagePath(GRAPH_B, 'X.md'))).toBe('- ![k](../assets/k.png)');
    expect(ctx.state.linksRewritten).toEqual([]);
  });

  it('fails when a referenced target asset is missing', async () => {
    const fs = new MemoryFileSystem();
    await seedGraph(fs, GRAPH_A, { pages: { 'X.md': '- ![k](../assets/k.png)' }, assets: { 'k.png': 'k' } });
    const ctx = makeContext(makeRequest(['X']), makeDeps(fs));
    await runUntil(ctx, 'rewrite-assets');
    await fs.remove(assetPath(GRAPH_B, 'k.png'));
    await expect(rewriteAssetReferences(ctx)).rejects.toBeInstanceOf(IntegrityError);
  });
});
