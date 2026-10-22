import type { Logger } from '../logging/logger';
import type {
  AssetAction,
  Conflict,
  FileOperation,
  LinkRewrite,
  MigrationRequest,
  MigrationSnapshot,
  ResolvedConflict,
} from '../model/types';
import type { LinkRenderer } from '../rendering/linkRenderer';
import type { ConflictResolver } from '../conflicts/conflictResolver';

export interface MigrationDependencies {
  readonly logger: Logger;
  readonly linkRenderer: LinkRenderer;
  readonly conflictResolver: ConflictResolver;
  readonly now: () => number;
}

/** Per-run working state. Created fresh for every migration; never shared. */
export interface MigrationState {
  targetGraphCreated: boolean;
  conflicts: Conflict[];
  resolvedConflicts: ResolvedConflict[];
  snapshot: MigrationSnapshot | undefined;
  affectedPages: string[];
  assetActions: AssetAction[];
  pagesMoved: string[];
  filesMoved: FileOperation[];
  filesCopied: FileOperation[];
  linksRewritten: LinkRewrite[];
  warnings: string[];
}

export interface MigrationContext {
  readonly request: MigrationRequest;
  readonly deps: MigrationDependencies;
  readonly state: MigrationState;
}

export function createInitialState(): MigrationState {
  return {
    targetGraphCreated: false,
    conflicts: [],
    resolvedConflicts: [],
    snapshot: undefined,
    affectedPages: [],
    assetActions: [],
    pagesMoved: [],
    filesMoved: [],
    filesCopied: [],
    linksRewritten: [],
    warnings: [],
  };
}

export class MigrationAbortedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationAbortedError';
  }
}
