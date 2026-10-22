import { describe, expect, it } from 'vitest';
import { InvalidMigrationRequestError, buildMigrationRequest } from '../src/migration/migrationRequest';
import { DEFAULT_GRAPH_LAYOUT } from '../src/model/types';
import { createSelectionState, setTargetPath, togglePage } from '../src/ui/selectionModel';

const source = { name: 'GraphA', path: 'C:\\graphs\\GraphA\\' };
const now = new Date('2026-10-22T10:00:00Z');
const pages = ['b page', 'A page', 'Ns/Child'].map((name) => ({ name, isJournal: false, hasFile: true }));

describe('buildMigrationRequest', () => {
  it('builds a normalized, sorted request', () => {
    let state = createSelectionState(pages);
    state = togglePage(togglePage(state, 'b page'), 'Ns/Child');
    state = setTargetPath(state, ' D:\\My Graphs\\Graph B\\ ');

    const request = buildMigrationRequest(state, source, { id: 'r1', now });

    expect(request).toEqual({
      id: 'r1',
      sourceGraph: { name: 'GraphA', path: 'C:/graphs/GraphA' },
      targetGraph: { name: 'Graph B', path: 'D:/My Graphs/Graph B' },
      pages: ['b page', 'Ns/Child'],
      layout: DEFAULT_GRAPH_LAYOUT,
      requestedAt: now,
    });
  });

  it('throws with readable reasons for an invalid selection', () => {
    const state = createSelectionState(pages);
    expect(() => buildMigrationRequest(state, null, { id: 'r2', now })).toThrow(InvalidMigrationRequestError);
    try {
      buildMigrationRequest(state, null, { id: 'r2', now });
    } catch (error) {
      expect((error as InvalidMigrationRequestError).reasons).toHaveLength(3);
    }
  });

  it('honours a custom graph layout', () => {
    const layout = { ...DEFAULT_GRAPH_LAYOUT, pagesDir: 'notes' };
    const state = setTargetPath(togglePage(createSelectionState(pages), 'A page'), '/home/u/graphB');
    expect(buildMigrationRequest(state, source, { id: 'r3', now, layout }).layout.pagesDir).toBe('notes');
  });
});
