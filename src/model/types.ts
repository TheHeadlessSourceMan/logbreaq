/** Core data model shared by all Graph Splitter modules. */

export interface GraphRef {
  /** Display name of the graph (usually the folder name). */
  readonly name: string;
  /** Absolute filesystem path of the graph root folder. */
  readonly path: string;
}

/** Configurable layout of a filesystem graph, relative to the graph root. */
export interface GraphLayout {
  readonly pagesDir: string;
  readonly journalsDir: string;
  readonly assetsDir: string;
  readonly logseqDir: string;
  readonly configFile: string;
}

export const DEFAULT_GRAPH_LAYOUT: GraphLayout = {
  pagesDir: 'pages',
  journalsDir: 'journals',
  assetsDir: 'assets',
  logseqDir: 'logseq',
  configFile: 'logseq/config.edn',
};

/** A single, atomic request to move one or more pages between graphs. */
export interface MigrationRequest {
  readonly id: string;
  readonly sourceGraph: GraphRef;
  readonly targetGraph: GraphRef;
  /** Original page names, de-duplicated and sorted. */
  readonly pages: readonly string[];
  readonly layout: GraphLayout;
  readonly requestedAt: Date;
}

/** Page name -> absolute graph path. Source of truth for link rendering. */
export type PageLocationIndex = ReadonlyMap<string, string>;

/** Target page -> pages that link to it. */
export type BacklinkIndex = ReadonlyMap<string, ReadonlySet<string>>;

/** Asset file name -> pages that reference it. */
export type AssetUsageIndex = ReadonlyMap<string, ReadonlySet<string>>;

export type ConflictKind = 'page-name' | 'asset-name' | 'selection-collision';

export interface Conflict {
  readonly kind: ConflictKind;
  /** Incoming page name or asset file name. */
  readonly subject: string;
  /** The existing item it collides with. */
  readonly existing: string;
  readonly detail?: string;
}

export type ConflictResolution =
  | { readonly kind: 'skip' }
  | { readonly kind: 'rename'; readonly newName: string }
  | { readonly kind: 'reuse-existing-asset' }
  | { readonly kind: 'copy-asset-as'; readonly newName: string }
  | { readonly kind: 'abort' };

export interface ResolvedConflict {
  readonly conflict: Conflict;
  readonly resolution: ConflictResolution;
}

export type AssetActionKind = 'move' | 'copy' | 'reuse';

export interface AssetAction {
  readonly asset: string;
  readonly action: AssetActionKind;
  readonly targetName: string;
}

export interface FileOperation {
  readonly from: string;
  readonly to: string;
  readonly sha256: string;
}

export interface LinkRewrite {
  readonly page: string;
  readonly before: string;
  readonly after: string;
}

export interface SnapshotEntry {
  readonly originalPath: string;
  readonly backupPath: string;
  readonly sha256: string;
}

export interface MigrationSnapshot {
  readonly id: string;
  readonly createdAt: Date;
  readonly backupDir: string;
  readonly entries: readonly SnapshotEntry[];
}

export type MigrationStatus = 'succeeded' | 'aborted' | 'rolled-back' | 'rollback-failed';

export interface MigrationReport {
  readonly requestId: string;
  readonly status: MigrationStatus;
  readonly completedSteps: readonly string[];
  readonly pagesMoved: readonly string[];
  readonly filesMoved: readonly FileOperation[];
  readonly filesCopied: readonly FileOperation[];
  readonly linksRewritten: readonly LinkRewrite[];
  readonly conflicts: readonly ResolvedConflict[];
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
  readonly durationMs: number;
}
