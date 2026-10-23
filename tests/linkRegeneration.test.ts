import { describe, expect, it } from 'vitest';
import type { ConflictResolver } from '../src/conflicts/conflictResolver';
import { IntegrityError } from '../src/migration/migrationContext';
import { LocationIndex } from '../src/indexing/pageLocationIndex';
import { regenerateLinksInBacklinkPages, regenerateLinksInMovedPages } from '../src/rendering/linkRegeneration';
import { GRAPH_A, GRAPH_B, GRAPH_C, makeContext, makeDeps, makeRequest, pagePath, runThrough, runUntil, seedGraph, writeFile, type GraphSeed } from './support/fixtures';
import { MemoryFileSystem } from './support/memoryFileSystem';

const toB = (page: string) => `logseq://graph/GraphB?page=${page}`;
const toA = (page: string) => `logseq://graph/GraphA?page=${page}`;

async function prepare(pages: string[], a: GraphSeed, b: GraphSeed = {}, conflictResolver?: ConflictResolver) {
  const fs = new MemoryFileSystem();
  await seedGraph(fs, GRAPH_A, a);
  await seedGraph(fs, GRAPH_B, b);
  const ctx = makeContext(makeRequest(pages), makeDeps(fs, conflictResolver ? { conflictResolver } : {}));
  return { fs, ctx };
}

describe('step 9: regenerateLinksInMovedPages', () => {
  it('renders links from the post-migration location of every target', async () => {
    const { fs, ctx } = await prepare(
      ['X', 'M'],
      {
        pages: {
          'X.md': [
            'alias:: Ex',
            '- stay [[Y]] [label]([[Y]]) #Y #[[Two Words]] {{embed [[Y]]}}',
            '- self [[X]] [[ex]] mutual [[M]]',
            '- already in B [B1](logseq://graph/GraphB?page=B1) [[B1]]',
            '- implicit [[Nothing Here]] unknown [u](logseq://graph/Nowhere?page=U) broken [b](logseq://graph/GraphA?page=Ghost)',
            '- `[[Y]]` in code',
          ].join('\n'),
          'M.md': '- [[X]]',
          'Y.md': '',
          'Two Words.md': '',
        },
      },
      { pages: { 'B1.md': '' } },
    );
    await runThrough(ctx, 'regenerate-moved-links');

    expect(fs.text(pagePath(GRAPH_B, 'X.md'))).toBe(
      [
        'alias:: Ex',
        `- stay [Y](${toA('Y')}) [label](${toA('Y')}) [#Y](${toA('Y')}) [#Two Words](${toA('Two%20Words')}) [Y](${toA('Y')}&embed=true)`,
        '- self [[X]] [[ex]] mutual [[M]]',
        '- already in B [[B1]] [[B1]]',
        '- implicit [[Nothing Here]] unknown [u](logseq://graph/Nowhere?page=U) broken [b](logseq://graph/GraphA?page=Ghost)',
        '- `[[Y]]` in code',
      ].join('\n'),
    );
    expect(fs.text(pagePath(GRAPH_B, 'M.md'))).toBe('- [[X]]');
    expect(ctx.state.warnings).toContain('Embed of "Y" in "X" is shown as a link because embeds cannot cross graphs.');
    expect(ctx.state.linksRewritten).toHaveLength(6);
    expect(ctx.state.generatedLinks.get(pagePath(GRAPH_B, 'X.md'))?.has(`[Y](${toA('Y')})`)).toBe(true);
  });

  it('uses the new name for links to a renamed page, but keeps aliases', async () => {
    const rename: ConflictResolver = {
      resolve: async (cs) => cs.map((conflict) => ({ conflict, resolution: { kind: 'rename', newName: 'X (A)' } })),
    };
    const { fs, ctx } = await prepare(['X'], { pages: { 'X.md': 'alias:: Ex\n- [[X]] [[Ex]]', 'P.md': '- [[x]] [[Ex]] #X' } }, { pages: { 'X.md': '' } }, rename);
    await runThrough(ctx, 'regenerate-backlinks');

    expect(fs.text(pagePath(GRAPH_B, 'X (A).md'))).toBe('alias:: Ex\n- [[X (A)]] [[Ex]]');
    expect(fs.text(pagePath(GRAPH_A, 'P.md'))).toBe(
      `- [X (A)](${toB('X%20%28A%29')}) [Ex](${toB('Ex')}) [#X (A)](${toB('X%20%28A%29')})`,
    );
    expect(fs.text(pagePath(GRAPH_B, 'X.md'))).toBe('');
  });

  it('refuses to render a link the location index does not agree with', async () => {
    const { ctx } = await prepare(['X'], { pages: { 'X.md': '- [[Y]]', 'Y.md': '' } });
    await runUntil(ctx, 'regenerate-moved-links');
    ctx.state.locationIndex = new LocationIndex();
    await expect(regenerateLinksInMovedPages(ctx)).rejects.toBeInstanceOf(IntegrityError);
  });
});

describe('step 10: regenerateLinksInBacklinkPages', () => {
  it('turns links to moved pages external in the source graph', async () => {
    const { fs, ctx } = await prepare(['X'], {
      pages: { 'X.md': 'alias:: Ex', 'P.md': '- [[X]] [see]([[X]]) #X {{embed [[X]]}} [[Ex]] [[Y]]', 'Y.md': '' },
    });
    await runThrough(ctx, 'regenerate-backlinks');
    expect(fs.text(pagePath(GRAPH_A, 'P.md'))).toBe(
      `- [X](${toB('X')}) [see](${toB('X')}) [#X](${toB('X')}) [X](${toB('X')}&embed=true) [Ex](${toB('Ex')}) [[Y]]`,
    );
  });

  it('collapses external links into local links in the target graph', async () => {
    const { fs, ctx } = await prepare(
      ['X'],
      { pages: { 'X.md': '' } },
      { pages: { 'B1.md': `- [X](${toA('X')}) [lbl](${toA('X')}) [#X](${toA('X')}) [E](${toA('X')}&embed=true)` } },
    );
    await runThrough(ctx, 'regenerate-backlinks');
    expect(fs.text(pagePath(GRAPH_B, 'B1.md'))).toBe('- [[X]] [lbl]([[X]]) #X {{embed [[X]]}}');
  });

  it('updates pages in other known graphs', async () => {
    const { fs, ctx } = await prepare(['X'], { pages: { 'X.md': '' } });
    await seedGraph(fs, GRAPH_C, { pages: { 'C1.md': `- [X](${toA('X')})` } });
    await writeFile(fs, '/graphs/GraphA/logseq/graph-splitter/page-locations.json', JSON.stringify({ version: 1, graphs: [{ ...GRAPH_C, pages: ['C1'] }] }));
    await runThrough(ctx, 'regenerate-backlinks');
    expect(fs.text('/graphs/GraphC/pages/C1.md')).toBe(`- [X](${toB('X')})`);
  });

  it('leaves files without changes untouched', async () => {
    const { ctx } = await prepare(['X'], { pages: { 'X.md': '- [[X]]', 'P.md': `- [X](${toB('X')})` } });
    await runUntil(ctx, 'regenerate-backlinks');
    const before = ctx.state.linksRewritten.length;
    await regenerateLinksInBacklinkPages(ctx);
    expect(ctx.state.linksRewritten.length).toBe(before);
  });
});
