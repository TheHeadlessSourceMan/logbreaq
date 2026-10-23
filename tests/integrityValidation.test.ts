import { describe, expect, it } from 'vitest';
import { encodeText } from '../src/fs/fileSystem';
import { sha256Hex } from '../src/fs/hash';
import { commitRemovals } from '../src/migration/commitRemovals';
import { IntegrityError, type MigrationContext } from '../src/migration/migrationContext';
import { runIntegrityValidation } from '../src/validation/integrityValidation';
import { GRAPH_A, GRAPH_B, assetPath, makeContext, makeDeps, makeRequest, pagePath, runThrough, runUntil, seedGraph, writeFile, type GraphSeed } from './support/fixtures';
import { MemoryFileSystem } from './support/memoryFileSystem';

const DEFAULT_A: GraphSeed = {
  pages: { 'X.md': '- [[Y]] ![p](../assets/p.png)', 'Y.md': '- [[X]]' },
  assets: { 'p.png': 'pixels' },
};

async function prepare(a: GraphSeed = DEFAULT_A) {
  const fs = new MemoryFileSystem();
  await seedGraph(fs, GRAPH_A, a);
  const ctx = makeContext(makeRequest(['X']), makeDeps(fs));
  await runUntil(ctx, 'validate-integrity');
  return { fs, ctx };
}

/** Simulates a bug in an earlier step: the file is changed but the run believes it wrote it. */
async function tamper(fs: MemoryFileSystem, ctx: MigrationContext, path: string, content: string): Promise<void> {
  await writeFile(fs, path, content);
  ctx.state.fileHashes.set(path, await sha256Hex(content));
  if (ctx.state.createdFiles.has(path)) {
    ctx.state.createdFiles.set(path, await sha256Hex(content));
  }
}

describe('step 12: runIntegrityValidation', () => {
  it('passes after a correct migration', async () => {
    const { ctx } = await prepare();
    await runIntegrityValidation(ctx);
    expect(ctx.state.warnings).toEqual([]);
  });

  it('fails when a created file is missing or altered', async () => {
    const { fs, ctx } = await prepare();
    await fs.remove(assetPath(GRAPH_B, 'p.png'));
    await writeFile(fs, '/graphs/GraphB/logseq/graph-splitter/page-locations.json', '{}');
    const error = await runIntegrityValidation(ctx).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IntegrityError);
    expect((error as IntegrityError).problems).toEqual(
      expect.arrayContaining([
        `Missing file: ${assetPath(GRAPH_B, 'p.png')}`,
        'Unexpected content in /graphs/GraphB/logseq/graph-splitter/page-locations.json',
        expect.stringMatching(/Asset "p.png" .* not in the target graph/),
      ]),
    );
  });

  it('fails when a page changed after it was written', async () => {
    const { fs, ctx } = await prepare();
    await writeFile(fs, pagePath(GRAPH_A, 'Y.md'), '- edited');
    await expect(runIntegrityValidation(ctx)).rejects.toThrow(/changed unexpectedly/);
  });

  it('fails when a backlink page still links locally to a moved page', async () => {
    const { fs, ctx } = await prepare();
    await tamper(fs, ctx, pagePath(GRAPH_A, 'Y.md'), '- [[X]]');
    await expect(runIntegrityValidation(ctx)).rejects.toThrow(/local link to "X", which now lives in another graph/);
  });

  it('fails for generated external links that do not resolve, warns for pre-existing ones', async () => {
    const { fs, ctx } = await prepare({
      pages: { 'X.md': '- [old](logseq://graph/GraphA?page=Nope) [u](logseq://graph/Unknown?page=U)', 'Y.md': '- [[X]]' },
    });
    await runIntegrityValidation(ctx);
    expect(ctx.state.warnings).toEqual([
      expect.stringMatching(/^Pre-existing: .*does not exist in graph "GraphA"/),
      expect.stringMatching(/^Pre-existing: .*unknown graph "Unknown"/),
    ]);

    const bad = '[X](logseq://graph/GraphA?page=Missing)';
    ctx.state.generatedLinks.set(pagePath(GRAPH_B, 'X.md'), new Set([bad]));
    await tamper(fs, ctx, pagePath(GRAPH_B, 'X.md'), `- ${bad}`);
    await expect(runIntegrityValidation(ctx)).rejects.toThrow(/"Missing", which does not exist in graph "GraphA"/);
  });

  it('flags external links into a page\'s own graph', async () => {
    const { fs, ctx } = await prepare();
    const own = '[Y](logseq://graph/GraphA?page=Y)';
    ctx.state.generatedLinks.set(pagePath(GRAPH_A, 'Y.md'), new Set([own]));
    await tamper(fs, ctx, pagePath(GRAPH_A, 'Y.md'), own);
    await expect(runIntegrityValidation(ctx)).rejects.toThrow(/external link into its own graph/);
  });

  it('treats assets missing before the migration as warnings', async () => {
    const { ctx } = await prepare({ pages: { 'X.md': '![g](../assets/gone.png)' } });
    await runIntegrityValidation(ctx);
    expect(ctx.state.warnings.at(-1)).toMatch(/^Pre-existing: asset "gone.png"/);
  });

  it('fails when a copied asset\'s original disappears', async () => {
    const { fs, ctx } = await prepare({
      pages: { 'X.md': '![s](../assets/s.png)', 'Y.md': '![s](../assets/s.png)' },
      assets: { 's.png': 'shared' },
    });
    await fs.remove(assetPath(GRAPH_A, 's.png'));
    await expect(runIntegrityValidation(ctx)).rejects.toThrow(/original disappeared/);
  });

  it('fails when a moved page file is missing', async () => {
    const { fs, ctx } = await prepare();
    await fs.remove(pagePath(GRAPH_B, 'X.md'));
    await expect(runIntegrityValidation(ctx)).rejects.toThrow(/Missing page file/);
  });
});

describe('commitRemovals', () => {
  async function validated() {
    const fs = new MemoryFileSystem();
    await seedGraph(fs, GRAPH_A, DEFAULT_A);
    const ctx = makeContext(makeRequest(['X']), makeDeps(fs));
    await runThrough(ctx, 'validate-integrity');
    return { fs, ctx };
  }

  it('removes moved originals after verifying their copies', async () => {
    const { fs, ctx } = await validated();
    await commitRemovals(ctx);
    expect(fs.has(pagePath(GRAPH_A, 'X.md'))).toBe(false);
    expect(fs.has(assetPath(GRAPH_A, 'p.png'))).toBe(false);
    expect(fs.has(pagePath(GRAPH_B, 'X.md'))).toBe(true);
    expect(ctx.state.warnings).toEqual([]);
  });

  it('keeps originals that changed, whose copy is not verifiable, or that cannot be removed', async () => {
    const { fs, ctx } = await validated();
    await writeFile(fs, pagePath(GRAPH_A, 'X.md'), '- edited during migration');
    await fs.writeBytes(assetPath(GRAPH_B, 'p.png'), encodeText('corrupted'), { overwrite: true });
    await commitRemovals(ctx);
    expect(fs.has(pagePath(GRAPH_A, 'X.md'))).toBe(true);
    expect(fs.has(assetPath(GRAPH_A, 'p.png'))).toBe(true);
    expect(ctx.state.warnings).toEqual([
      expect.stringMatching(/^Kept .*X\.md: it was modified/),
      expect.stringMatching(/^Kept .*p\.png: its copy/),
    ]);
  });

  it('turns removal failures into warnings', async () => {
    const { fs, ctx } = await validated();
    fs.setReadOnly(pagePath(GRAPH_A, 'X.md'));
    await commitRemovals(ctx);
    expect(fs.has(pagePath(GRAPH_A, 'X.md'))).toBe(true);
    expect(ctx.state.warnings[0]).toMatch(/Could not remove .*EACCES/);
  });

  it('keeps originals whose copy was never recorded', async () => {
    const { fs, ctx } = await validated();
    ctx.state.filesMoved.length = 0;
    await commitRemovals(ctx);
    expect(fs.has(pagePath(GRAPH_A, 'X.md'))).toBe(true);
  });
});
