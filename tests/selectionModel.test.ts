import { describe, expect, it } from 'vitest';
import {
  createSelectionState,
  isMovable,
  setFilter,
  setTargetPath,
  togglePage,
  validateSelection,
  visiblePages,
  type PageOption,
} from '../src/ui/selectionModel';

const graph = { name: 'GraphA', path: 'C:/graphs/GraphA' };
const pages: PageOption[] = [
  { name: 'Zeta', isJournal: false, hasFile: true },
  { name: 'Álpha ünïcode', isJournal: false, hasFile: true },
  { name: 'Project/Sub page', isJournal: false, hasFile: true },
  { name: 'Oct 22nd, 2026', isJournal: true, hasFile: true },
  { name: 'Referenced only', isJournal: false, hasFile: false },
];

describe('selectionModel', () => {
  it('only offers file-backed, non-journal pages, sorted', () => {
    const state = createSelectionState(pages);
    expect(state.pages.map((p) => p.name)).toEqual(['Álpha ünïcode', 'Project/Sub page', 'Zeta']);
    expect(isMovable(pages[3]!)).toBe(false);
    expect(isMovable(pages[4]!)).toBe(false);
  });

  it('drops preselected pages that are not movable', () => {
    const state = createSelectionState(pages, ['Zeta', 'Referenced only', 'Missing']);
    expect([...state.selected]).toEqual(['Zeta']);
  });

  it('toggles selection immutably', () => {
    const initial = createSelectionState(pages);
    const selected = togglePage(initial, 'Zeta');
    expect(initial.selected.has('Zeta')).toBe(false);
    expect(selected.selected.has('Zeta')).toBe(true);
    expect(togglePage(selected, 'Zeta').selected.has('Zeta')).toBe(false);
  });

  it('filters visible pages case-insensitively', () => {
    const state = setFilter(createSelectionState(pages), '  project ');
    expect(visiblePages(state).map((p) => p.name)).toEqual(['Project/Sub page']);
    expect(visiblePages(setFilter(state, ''))).toHaveLength(3);
  });

  it('reports all problems for an empty selection', () => {
    expect(validateSelection(createSelectionState(pages), null)).toEqual([
      'no-source-graph',
      'no-pages-selected',
      'target-path-empty',
    ]);
  });

  it('rejects relative target paths', () => {
    const state = setTargetPath(togglePage(createSelectionState(pages), 'Zeta'), 'graphs/B');
    expect(validateSelection(state, graph)).toEqual(['target-path-not-absolute']);
  });

  it('rejects the source graph as target regardless of case and separators', () => {
    const state = setTargetPath(togglePage(createSelectionState(pages), 'Zeta'), 'c:\\Graphs\\graphA\\');
    expect(validateSelection(state, graph)).toEqual(['target-is-source']);
  });

  it('rejects selections containing unknown pages', () => {
    const state = { ...setTargetPath(createSelectionState(pages), 'D:/B'), selected: new Set(['Ghost']) };
    expect(validateSelection(state, graph)).toEqual(['unknown-page-selected']);
  });

  it('accepts a valid multi-page selection', () => {
    let state = createSelectionState(pages);
    state = togglePage(togglePage(state, 'Zeta'), 'Project/Sub page');
    state = setTargetPath(state, 'D:/My Graphs/Graph B');
    expect(validateSelection(state, graph)).toEqual([]);
  });
});
