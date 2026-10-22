import { DEFAULT_GRAPH_LAYOUT, type GraphLayout, type GraphRef, type MigrationRequest } from '../model/types';
import { baseName, normalizePath } from '../fs/paths';
import { VALIDATION_MESSAGES, validateSelection, type SelectionState } from '../ui/selectionModel';

export interface RequestBuilderOptions {
  readonly id: string;
  readonly now: Date;
  readonly layout?: GraphLayout;
}

export class InvalidMigrationRequestError extends Error {
  constructor(readonly reasons: readonly string[]) {
    super(`Invalid migration request: ${reasons.join(' ')}`);
    this.name = 'InvalidMigrationRequestError';
  }
}

/** Converts a validated UI selection into an immutable migration request. */
export function buildMigrationRequest(
  state: SelectionState,
  sourceGraph: GraphRef | null,
  options: RequestBuilderOptions,
): MigrationRequest {
  const errors = validateSelection(state, sourceGraph);
  if (errors.length > 0 || sourceGraph === null) {
    throw new InvalidMigrationRequestError(errors.map((e) => VALIDATION_MESSAGES[e]));
  }
  const targetPath = normalizePath(state.targetPath);
  return {
    id: options.id,
    sourceGraph: { name: sourceGraph.name, path: normalizePath(sourceGraph.path) },
    targetGraph: { name: baseName(targetPath), path: targetPath },
    pages: [...state.selected].sort((a, b) => a.localeCompare(b)),
    layout: options.layout ?? DEFAULT_GRAPH_LAYOUT,
    requestedAt: options.now,
  };
}
