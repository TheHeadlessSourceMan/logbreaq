import { describe, expect, it } from 'vitest';
import { encodeText } from '../src/fs/fileSystem';
import { sha256Hex } from '../src/fs/hash';
import { replaceTrackedFile } from '../src/migration/trackedFiles';
import { createSnapshot, restoreSnapshot } from '../src/rollback/snapshot';
import { GRAPH_A, GRAPH_B, assetPath, makeContext, makeDeps, makeRequest, pagePath, runThrough, runUntil, seedGraph, writeFile } from './support/fixtures';
import { MemoryFileSystem } from './support/memoryFileSystem';

const INDEX_A = '/graphs/GraphA/logseq/graph-splitter/page-locations.json';

async function prepare() {
  const fs = new MemoryFileSystem();
  await seedGraph(fs, GRAPH_A, {
    pages: { 'X.md': '- ![p](../assets/p.png) [[Y]]', 'Y.md': '- [[X]]', 'Z.md': '- unrelated', 'S.md': '![s](../assets/shared.png)' },
    assets: { 'p.png': 'pixels', 'shared.png': 'shared' },
  });
  await writeFile(fs, INDEX_A, JSON.stringify({ version: 1, graphs: [] }));
  const ctx = makeContext(makeRequest(['X']), makeDeps(fs));
  return { fs, ctx };
}

describe('step 4: createSnapshot', () => {
  it('backs up moved pages, affected pages, moved assets and the index, with a manifest', async () => {
    const { fs, ctx } = await prepare();
    await runThrough(ctx, 'create-snapshot');
    const snapshot = ctx.state.snapshot!;

    expect(snapshot.backupDir).toBe('/graphs/GraphA/logseq/bak/graph-splitter/2026-10-22T10-00-01-000Z_req-1');
    expect(snapshot.entries.map((e) => e.originalPath).sort()).toEqual(
      [pagePath(GRAPH_A, 'X.md'), pagePath(GRAPH_A, 'Y.md'), assetPath(GRAPH_A, 'p.png'), INDEX_A].sort(),
    );
    for (const entry of snapshot.entries) {
      expect(await sha256Hex(await fs.readBytes(entry.backupPath))).toBe(entry.sha256);
      expect(entry.sha256).toBe(await sha256Hex(await fs.readBytes(entry.originalPath)));
    }
    const manifest = JSON.parse(fs.text(`${snapshot.backupDir}/manifest.json`)) as { entries: unknown[]; pages: string[] };
    expect(manifest.entries).toHaveLength(4);
    expect(manifest.pages).toEqual(['X']);
  });

  it('refuses to reuse an existing backup folder', async () => {
    const { fs, ctx } = await prepare();
    await runUntil(ctx, 'create-snapshot');
    await fs.mkdir('/graphs/GraphA/logseq/bak/graph-splitter/2026-10-22T10-00-01-000Z_req-1');
    await expect(createSnapshot(ctx)).rejects.toThrow(/already exists/);
  });

  it('aborts if a file changed since it was scanned', async () => {
    const { fs, ctx } = await prepare();
    await runUntil(ctx, 'create-snapshot');
    await writeFile(fs, pagePath(GRAPH_A, 'Y.md'), '- edited concurrently');
    await expect(createSnapshot(ctx)).rejects.toThrow(/modified by another program/);
  });

  it('aborts if a backup cannot be written', async () => {
    const { fs, ctx } = await prepare();
    await runUntil(ctx, 'create-snapshot');
    fs.failOn = (op, path) => op === 'write' && path.includes('/bak/');
    await expect(createSnapshot(ctx)).rejects.toThrow(/Simulated write failure/);
    expect(ctx.state.snapshot).toBeUndefined();
  });
});

describe('restoreSnapshot', () => {
  async function migrateUntilBacklinks() {
    const { fs, ctx } = await prepare();
    await runThrough(ctx, 'regenerate-backlinks');
    return { fs, ctx };
  }

  it('restores modified files and removes created files', async () => {
    const { fs, ctx } = await migrateUntilBacklinks();
    const originalY = '- [[X]]';
    expect(fs.text(pagePath(GRAPH_A, 'Y.md'))).not.toBe(originalY);
    expect(fs.has(pagePath(GRAPH_B, 'X.md'))).toBe(true);

    await restoreSnapshot(ctx);

    expect(fs.text(pagePath(GRAPH_A, 'Y.md'))).toBe(originalY);
    expect(fs.text(INDEX_A)).toBe(JSON.stringify({ version: 1, graphs: [] }));
    expect(fs.has(pagePath(GRAPH_B, 'X.md'))).toBe(false);
    expect(fs.has(assetPath(GRAPH_B, 'p.png'))).toBe(false);
    expect(fs.text(pagePath(GRAPH_A, 'X.md'))).toBe('- ![p](../assets/p.png) [[Y]]');
    expect(ctx.state.rollbackLog).toContain(`Restored ${pagePath(GRAPH_A, 'Y.md')}`);
  });

  it('preserves concurrent edits before restoring or removing', async () => {
    const { fs, ctx } = await migrateUntilBacklinks();
    await writeFile(fs, pagePath(GRAPH_A, 'Y.md'), '- user typed this');
    await writeFile(fs, pagePath(GRAPH_B, 'X.md'), '- user edited the moved page');

    await restoreSnapshot(ctx);

    const conflicted = fs.filesUnder(`${ctx.state.snapshot!.backupDir}/conflicted`).map((p) => fs.text(p)).sort();
    expect(conflicted).toEqual(['- user edited the moved page', '- user typed this']);
    expect(fs.text(pagePath(GRAPH_A, 'Y.md'))).toBe('- [[X]]');
  });

  it('leaves files the migration never changed alone, even if edited elsewhere', async () => {
    const { fs, ctx } = await prepare();
    await runThrough(ctx, 'create-snapshot');
    await writeFile(fs, pagePath(GRAPH_A, 'X.md'), '- edited after snapshot');
    await restoreSnapshot(ctx);
    expect(fs.text(pagePath(GRAPH_A, 'X.md'))).toBe('- edited after snapshot');
    expect(ctx.state.rollbackLog).toContain(`Left ${pagePath(GRAPH_A, 'X.md')} as modified by another program`);
  });

  it('restores deleted originals', async () => {
    const { fs, ctx } = await migrateUntilBacklinks();
    await fs.remove(pagePath(GRAPH_A, 'Y.md'));
    await restoreSnapshot(ctx);
    expect(fs.text(pagePath(GRAPH_A, 'Y.md'))).toBe('- [[X]]');
  });

  it('continues past failures and reports them', async () => {
    const { fs, ctx } = await migrateUntilBacklinks();
    fs.setReadOnly(pagePath(GRAPH_A, 'Y.md'));
    fs.failOn = (op, path) => op === 'remove' && path.endsWith('/GraphB/pages/X.md');
    await expect(restoreSnapshot(ctx)).rejects.toThrow(/Rollback incomplete/);
    expect(fs.has(assetPath(GRAPH_B, 'p.png'))).toBe(false);
    expect(ctx.state.rollbackLog.some((l) => l.startsWith('Could not restore'))).toBe(true);
    expect(ctx.state.rollbackLog.some((l) => l.startsWith('Could not remove'))).toBe(true);
  });

  it('detects a corrupted backup', async () => {
    const { fs, ctx } = await migrateUntilBacklinks();
    const entry = ctx.state.snapshot!.entries.find((e) => e.originalPath.endsWith('Y.md'))!;
    await writeFile(fs, entry.backupPath, 'garbage');
    await expect(restoreSnapshot(ctx)).rejects.toThrow(/corrupt/);
  });

  it('does nothing without a snapshot', async () => {
    const { ctx } = await prepare();
    await restoreSnapshot(ctx);
    expect(ctx.state.rollbackLog).toEqual(['No snapshot was taken; nothing to restore.']);
  });

  it('refuses to overwrite files that are neither created nor backed up', async () => {
    const { ctx } = await prepare();
    await runThrough(ctx, 'create-snapshot');
    await expect(replaceTrackedFile(ctx, pagePath(GRAPH_A, 'Z.md'), encodeText('x'))).rejects.toThrow(/no backup exists/);
  });
});
