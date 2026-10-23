import { describe, expect, it } from 'vitest';
import { detectConflicts } from '../src/conflicts/conflictDetection';
import { detectAndResolveConflicts } from '../src/conflicts/conflictResolution';
import type { ConflictResolver } from '../src/conflicts/conflictResolver';
import type { ConflictResolution } from '../src/model/types';
import { GRAPH_A, GRAPH_B, makeContext, makeDeps, makeRequest, runUntil, seedGraph, type GraphSeed } from './support/fixtures';
import { MemoryFileSystem } from './support/memoryFileSystem';

function resolver(choose: (subject: string) => ConflictResolution): ConflictResolver {
  return { resolve: async (cs) => cs.map((conflict) => ({ conflict, resolution: choose(conflict.subject) })) };
}

async function setup(pages: string[], a: GraphSeed, b: GraphSeed, conflictResolver?: ConflictResolver, caseSensitive = true) {
  const fs = new MemoryFileSystem(caseSensitive);
  await seedGraph(fs, GRAPH_A, a);
  await seedGraph(fs, GRAPH_B, b);
  const ctx = makeContext(makeRequest(pages), makeDeps(fs, conflictResolver ? { conflictResolver } : {}));
  await runUntil(ctx, 'resolve-conflicts');
  return ctx;
}

describe('detectConflicts', () => {
  it('finds no conflicts for distinct names', async () => {
    const ctx = await setup(['X'], { pages: { 'X.md': '' } }, { pages: { 'Y.md': '' } });
    expect(await detectConflicts(ctx)).toEqual([]);
  });

  it('detects page-name conflicts case-insensitively, through aliases and by file name', async () => {
    const ctx = await setup(
      ['Alpha', 'Beta', 'Gamma'],
      { pages: { 'Alpha.md': '', 'Beta.md': '', 'Gamma.md': '' } },
      { pages: { 'ALPHA.md': '', 'Other.md': 'alias:: beta\n', 'gamma.md': 'title:: Something Else\n' } },
    );
    expect(await detectConflicts(ctx)).toEqual([
      { kind: 'page-name', subject: 'Alpha', existing: 'ALPHA' },
      { kind: 'page-name', subject: 'Beta', existing: 'Other' },
      { kind: 'page-name', subject: 'Gamma', existing: 'gamma.md', detail: expect.stringContaining('same name') },
    ]);
  });

  it('detects selected pages whose file names collide on case-insensitive filesystems', async () => {
    const ctx = await setup(
      ['One', 'Two'],
      { pages: { 'Foo.md': 'title:: One\n', 'foo.md': 'title:: Two\n' } },
      {},
    );
    expect(await detectConflicts(ctx)).toEqual([
      { kind: 'selection-collision', subject: 'Two', existing: 'One', detail: expect.any(String) },
    ]);
  });

  it('warns when an incoming alias names an existing target page', async () => {
    const ctx = await setup(['X'], { pages: { 'X.md': 'alias:: Shared\n' } }, { pages: { 'Shared.md': '' } });
    await detectConflicts(ctx);
    expect(ctx.state.warnings[0]).toMatch(/Alias "Shared"/);
  });
});

describe('detectAndResolveConflicts', () => {
  const a = { pages: { 'X.md': '', 'Y.md': '' } };
  const b = { pages: { 'X.md': '- existing' } };

  it('moves every selected page when there are no conflicts', async () => {
    const ctx = await setup(['X', 'Y'], a, {});
    await detectAndResolveConflicts(ctx);
    expect([...ctx.state.movingKeys].sort()).toEqual(['x', 'y']);
  });

  it('skips a conflicting page', async () => {
    const ctx = await setup(['X', 'Y'], a, b, resolver(() => ({ kind: 'skip' })));
    await detectAndResolveConflicts(ctx);
    expect([...ctx.state.movingKeys]).toEqual(['y']);
    expect(ctx.state.resolvedConflicts).toHaveLength(1);
  });

  it('warns when every page is skipped', async () => {
    const ctx = await setup(['X'], a, b, resolver(() => ({ kind: 'skip' })));
    await detectAndResolveConflicts(ctx);
    expect(ctx.state.movingKeys.size).toBe(0);
    expect(ctx.state.warnings).toContain('All selected pages were skipped; nothing will be moved.');
  });

  it('renames a conflicting page', async () => {
    const ctx = await setup(['X', 'Y'], a, b, resolver(() => ({ kind: 'rename', newName: ' X (from A) ' })));
    await detectAndResolveConflicts(ctx);
    expect(ctx.state.renames.get('x')).toBe('X (from A)');
    expect(ctx.state.movingKeys.has('x')).toBe(true);
  });

  it.each([
    ['abort', () => ({ kind: 'abort' }) as ConflictResolution, /aborted by user/],
    ['rename to another existing page', () => ({ kind: 'rename', newName: 'x' }) as ConflictResolution, /still collides/],
    ['rename onto another selected page', () => ({ kind: 'rename', newName: 'Y' }) as ConflictResolution, /would collide/],
    ['rename to an empty name', () => ({ kind: 'rename', newName: '  ' }) as ConflictResolution, /Empty new name/],
    ['an asset resolution', () => ({ kind: 'reuse-existing-asset' }) as ConflictResolution, /not valid/],
  ])('aborts on %s', async (_label, choose, message) => {
    const ctx = await setup(['X', 'Y'], a, b, resolver(choose));
    await expect(detectAndResolveConflicts(ctx)).rejects.toThrow(message);
  });

  it('aborts when a conflict is left unresolved', async () => {
    const ctx = await setup(['X'], a, b, { resolve: async () => [] });
    await expect(detectAndResolveConflicts(ctx)).rejects.toThrow(/Not every conflict/);
  });

  it('aborts when a resolution names an unselected page', async () => {
    const ctx = await setup(['X'], a, b, {
      resolve: async (cs) => [
        { conflict: cs[0]!, resolution: { kind: 'skip' } },
        { conflict: { kind: 'page-name', subject: 'Nope', existing: 'Nope' }, resolution: { kind: 'skip' } },
      ],
    });
    await expect(detectAndResolveConflicts(ctx)).rejects.toThrow(/Not every conflict|not selected/);
  });
});
