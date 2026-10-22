import type { GraphRef } from '../model/types';
import { isAbsolutePath, isSamePath } from '../fs/paths';

export interface PageOption {
  /** Original (display) page name. */
  readonly name: string;
  readonly isJournal: boolean;
  /** False for pages that are only referenced and have no backing file. */
  readonly hasFile: boolean;
}

export interface SelectionState {
  readonly pages: readonly PageOption[];
  readonly selected: ReadonlySet<string>;
  readonly targetPath: string;
  readonly filter: string;
}

export type ValidationError =
  | 'no-source-graph'
  | 'no-pages-selected'
  | 'unknown-page-selected'
  | 'target-path-empty'
  | 'target-path-not-absolute'
  | 'target-is-source';

export const VALIDATION_MESSAGES: Readonly<Record<ValidationError, string>> = {
  'no-source-graph': 'No file-based graph is currently open.',
  'no-pages-selected': 'Select at least one page to move.',
  'unknown-page-selected': 'A selected page is no longer available in this graph.',
  'target-path-empty': 'Enter the folder of the target graph.',
  'target-path-not-absolute': 'The target graph folder must be an absolute path.',
  'target-is-source': 'The target graph must differ from the current graph.',
};

/** Only pages backed by a file in pages/ can be moved. */
export function isMovable(page: PageOption): boolean {
  return page.hasFile && !page.isJournal;
}

export function createSelectionState(
  pages: readonly PageOption[],
  preselected: readonly string[] = [],
): SelectionState {
  const movable = pages.filter(isMovable).sort((a, b) => a.name.localeCompare(b.name));
  const available = new Set(movable.map((p) => p.name));
  return {
    pages: movable,
    selected: new Set(preselected.filter((name) => available.has(name))),
    targetPath: '',
    filter: '',
  };
}

export function togglePage(state: SelectionState, name: string): SelectionState {
  const selected = new Set(state.selected);
  if (selected.has(name)) {
    selected.delete(name);
  } else {
    selected.add(name);
  }
  return { ...state, selected };
}

export function setTargetPath(state: SelectionState, targetPath: string): SelectionState {
  return { ...state, targetPath };
}

export function setFilter(state: SelectionState, filter: string): SelectionState {
  return { ...state, filter };
}

export function visiblePages(state: SelectionState): readonly PageOption[] {
  const needle = state.filter.trim().toLowerCase();
  return needle === '' ? state.pages : state.pages.filter((p) => p.name.toLowerCase().includes(needle));
}

export function validateSelection(
  state: SelectionState,
  sourceGraph: GraphRef | null,
): ValidationError[] {
  const errors: ValidationError[] = [];
  if (sourceGraph === null) {
    errors.push('no-source-graph');
  }
  if (state.selected.size === 0) {
    errors.push('no-pages-selected');
  }
  const available = new Set(state.pages.map((p) => p.name));
  if ([...state.selected].some((name) => !available.has(name))) {
    errors.push('unknown-page-selected');
  }
  const target = state.targetPath.trim();
  if (target === '') {
    errors.push('target-path-empty');
  } else if (!isAbsolutePath(target)) {
    errors.push('target-path-not-absolute');
  } else if (sourceGraph !== null && isSamePath(target, sourceGraph.path)) {
    errors.push('target-is-source');
  }
  return errors;
}
