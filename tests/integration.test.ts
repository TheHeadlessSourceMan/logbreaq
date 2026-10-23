import { describe, expect, it } from 'vitest';
import type { ConflictResolver } from '../src/conflicts/conflictResolver';
import { runMigration } from '../src/migration/migrationWorkflow';
import type { GraphRef } from '../src/model/types';
import { GRAPH_A, GRAPH_B, assetPath, makeDeps, makeRequest, pagePath, seedGraph } from './support/fixtures';
import { MemoryFileSystem } from './support/memoryFileSystem';

const toA = (page: string) => `logseq://graph/GraphA?page=${page}`;
const toB = (page: string) => `logseq://graph/GraphB?page=${page}`;

/** All files except snapshots, keyed by path. */
function contents(fs: MemoryFileSystem, ...roots: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const root of roots) {
    for (const path of fs.filesUnder(root)) {
      if (!path.includes('/logseq/bak/')) {
        result[path] = fs.text(path);
      }
    }
  }
  return result;
}

const ORIGINAL_A = {
  pages: {
    'X.md': '- links [[Y]] and [[Z]] ![img](../assets/pic.png)',
    'Y.md': '- see [[X]]',
    'Z.md': '- uses ![shared](../assets/shared.png) and [[X]]',
    'P.md': '- [[X]] #X {{embed [[X]]}}',
  },
  assets: { 'pic.png': 'pic', 'shared.png': 'shared' },
};

describe('integration: moving pages between graphs', () => {
  it('moves a page into a new graph with links, assets and index', async () => {
    const fs = new MemoryFileSystem();
    await seedGraph(fs, GRAPH_A, ORIGINAL_A);
    const report = await runMigration(makeRequest(['X']), makeDeps(fs));

    expect(report.status).toBe('succeeded');
    expect(fs.has(pagePath(GRAPH_A, 'X.md'))).toBe(false);
    expect(fs.has(assetPath(GRAPH_A, 'pic.png'))).toBe(false);
    expect(fs.text(assetPath(GRAPH_B, 'pic.png'))).toBe('pic');
    expect(fs.text(pagePath(GRAPH_B, 'X.md'))).toBe(`- links [Y](${toA('Y')}) and [Z](${toA('Z')}) ![img](../assets/pic.png)`);
    expect(fs.text(pagePath(GRAPH_A, 'Y.md'))).toBe(`- see [X](${toB('X')})`);
    expect(fs.text(pagePath(GRAPH_A, 'P.md'))).toBe(`- [X](${toB('X')}) [#X](${toB('X')}) [X](${toB('X')}&embed=true)`);
    expect(fs.text(assetPath(GRAPH_A, 'shared.png'))).toBe('shared');
    for (const index of ['/graphs/GraphA', '/graphs/GraphB']) {
      const json = JSON.parse(fs.text(`${index}/logseq/graph-splitter/page-locations.json`)) as { graphs: { name: string; pages: string[] }[] };
      expect(json.graphs.find((g) => g.name === 'GraphB')?.pages).toEqual(['X']);
    }
    expect(report.filesMoved.map((f) => f.to)).toEqual([pagePath(GRAPH_B, 'X.md'), assetPath(GRAPH_B, 'pic.png')]);
    expect(report.warnings).toEqual(['Embed of "X" in "P" is shown as a link because embeds cannot cross graphs.']);
  });

  it('collapses external links into local links as related pages follow (A -> B, then Y -> B)', async () => {
    const fs = new MemoryFileSystem();
    await seedGraph(fs, GRAPH_A, ORIGINAL_A);
    expect((await runMigration(makeRequest(['X']), makeDeps(fs))).status).toBe('succeeded');
    expect((await runMigration(makeRequest(['Y'], { id: 'req-2' }), makeDeps(fs))).status).toBe('succeeded');

    expect(fs.text(pagePath(GRAPH_B, 'Y.md'))).toBe('- see [[X]]');
    expect(fs.text(pagePath(GRAPH_B, 'X.md'))).toBe(`- links [[Y]] and [Z](${toA('Z')}) ![img](../assets/pic.png)`);

    expect((await runMigration(makeRequest(['Z', 'P'], { id: 'req-3' }), makeDeps(fs))).status).toBe('succeeded');
    expect(fs.text(pagePath(GRAPH_B, 'X.md'))).toBe(ORIGINAL_A.pages['X.md']);
    expect(fs.text(pagePath(GRAPH_B, 'P.md'))).toBe('- [[X]] #X {{embed [[X]]}}');
    expect(fs.text(pagePath(GRAPH_B, 'Z.md'))).toBe(ORIGINAL_A.pages['Z.md']);
    expect(fs.text(assetPath(GRAPH_B, 'shared.png'))).toBe('shared');
  });

  it('moves pages back and restores the original text', async () => {
    const fs = new MemoryFileSystem();
    await seedGraph(fs, GRAPH_A, ORIGINAL_A);
    const before = contents(fs, `${GRAPH_A.path}/pages`, `${GRAPH_A.path}/assets`);
    await runMigration(makeRequest(['X']), makeDeps(fs));
    const back = await runMigration(makeRequest(['X'], { id: 'req-2', sourceGraph: GRAPH_B, targetGraph: GRAPH_A }), makeDeps(fs));

    expect(back.status).toBe('succeeded');
    expect(contents(fs, `${GRAPH_A.path}/pages`, `${GRAPH_A.path}/assets`)).toEqual(before);
    expect(fs.filesUnder(`${GRAPH_B.path}/pages`)).toEqual([]);
  });

  it('rolls a multi-page selection back completely when one page fails', async () => {
    const fs = new MemoryFileSystem();
    await seedGraph(fs, GRAPH_A, ORIGINAL_A);
    const before = contents(fs, '/graphs');
    fs.failOn = (op, path) => op === 'write' && path === pagePath(GRAPH_B, 'Y.md');

    const report = await runMigration(makeRequest(['X', 'Y']), makeDeps(fs));

    expect(report.status).toBe('rolled-back');
    expect(contents(fs, '/graphs')).toEqual(before);
    expect(report.errors[0]).toMatch(/Simulated write failure/);
  });

  it('moves into an existing graph, renaming a conflicting page and reusing identical assets', async () => {
    const fs = new MemoryFileSystem(false);
    await seedGraph(fs, GRAPH_A, ORIGINAL_A);
    await seedGraph(fs, GRAPH_B, { pages: { 'x.md': '- B owns x', 'B1.md': '- [[X]]' }, assets: { 'PIC.png': 'pic' } });
    const rename: ConflictResolver = {
      resolve: async (cs) => cs.map((conflict) => ({ conflict, resolution: { kind: 'rename', newName: 'X from A' } })),
    };

    const report = await runMigration(makeRequest(['X']), makeDeps(fs, { conflictResolver: rename }));

    expect(report.status).toBe('succeeded');
    expect(fs.text(pagePath(GRAPH_B, 'x.md'))).toBe('- B owns x');
    expect(fs.text(pagePath(GRAPH_B, 'B1.md'))).toBe('- [[X]]');
    expect(fs.text(pagePath(GRAPH_B, 'X from A.md'))).toBe(`- links [Y](${toA('Y')}) and [Z](${toA('Z')}) ![img](../assets/PIC.png)`);
    expect(fs.text(pagePath(GRAPH_A, 'Y.md'))).toBe(`- see [X from A](${toB('X%20from%20A')})`);
    expect(fs.has(assetPath(GRAPH_A, 'pic.png'))).toBe(true);
    expect(report.conflicts.map((c) => c.resolution.kind)).toEqual(['rename', 'reuse-existing-asset']);
  });

  it('handles unicode, namespaces, punctuation and graphs on different drives with spaces', async () => {
    const source: GraphRef = { name: 'My Notes', path: 'C:/Users/me/My Notes' };
    const target: GraphRef = { name: 'Work Graph', path: 'D:/Graphs/Work Graph' };
    const fs = new MemoryFileSystem(false);
    await seedGraph(fs, source, {
      pages: {
        'Projekt___Über, v1.2.md': '- parent [[Projekt]] peer [[Q: what?]]',
        'Projekt.md': '- child [[Projekt/Über, v1.2]]',
        'Q%3A what%3F.md': '- [[Projekt/Über, v1.2]]',
      },
    });

    const report = await runMigration(
      makeRequest(['projekt/über, v1.2', 'Q: what?'], { sourceGraph: source, targetGraph: target }),
      makeDeps(fs),
    );

    expect(report.status).toBe('succeeded');
    expect(fs.text('D:/Graphs/Work Graph/pages/Projekt___Über, v1.2.md')).toBe(
      '- parent [Projekt](logseq://graph/My%20Notes?page=Projekt) peer [[Q: what?]]',
    );
    expect(fs.text('C:/Users/me/My Notes/pages/Projekt.md')).toBe(
      '- child [Projekt/Über, v1.2](logseq://graph/Work%20Graph?page=Projekt%2F%C3%9Cber%2C%20v1.2)',
    );
    expect(fs.text('D:/Graphs/Work Graph/pages/Q%3A what%3F.md')).toBe('- [[Projekt/Über, v1.2]]');
  });

  it('keeps both copies when a moved original cannot be deleted', async () => {
    const fs = new MemoryFileSystem();
    await seedGraph(fs, GRAPH_A, ORIGINAL_A);
    fs.setReadOnly(pagePath(GRAPH_A, 'X.md'));
    const report = await runMigration(makeRequest(['X']), makeDeps(fs));
    expect(report.status).toBe('succeeded');
    expect(fs.text(pagePath(GRAPH_A, 'X.md'))).toBe(ORIGINAL_A.pages['X.md']);
    expect(fs.has(pagePath(GRAPH_B, 'X.md'))).toBe(true);
    expect(report.warnings.some((w) => w.startsWith('Could not remove'))).toBe(true);
  });

  it('handles self references, mutual references and pages with thousands of links', async () => {
    const fs = new MemoryFileSystem();
    const many = Array.from({ length: 2000 }, (_, i) => `- [[Stay ${i % 10}]] [[Big]] [[Partner]]`).join('\n');
    const stays = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`Stay ${i}.md`, `- [[Big]]`]));
    await seedGraph(fs, GRAPH_A, { pages: { 'Big.md': many, 'Partner.md': '- [[Big]]', ...stays } });

    const report = await runMigration(makeRequest(['Big', 'Partner']), makeDeps(fs));

    expect(report.status).toBe('succeeded');
    const moved = fs.text(pagePath(GRAPH_B, 'Big.md'));
    expect(moved.match(/\[\[Big\]\]/g)).toHaveLength(2000);
    expect(moved.match(/\[\[Partner\]\]/g)).toHaveLength(2000);
    expect(moved.match(/logseq:\/\/graph\/GraphA\?page=Stay%20\d/g)).toHaveLength(2000);
    expect(fs.text(pagePath(GRAPH_A, 'Stay 3.md'))).toBe(`- [Big](${toB('Big')})`);
  });
});
