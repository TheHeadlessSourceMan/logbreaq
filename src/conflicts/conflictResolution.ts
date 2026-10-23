import { resolvePageKey } from '../indexing/graphScanner';
import type { ResolvedConflict } from '../model/types';
import { pageKey, pageNameToFileName } from '../parsing/pageNames';
import {
  MigrationAbortedError,
  graphDir,
  sourceGraph,
  targetGraph,
  type MigrationContext,
} from '../migration/migrationContext';
import { detectConflicts } from './conflictDetection';
import { containsAbort, isCompleteResolution } from './conflictResolver';

/** Applies user resolutions and verifies the resulting plan is free of collisions. */
export async function applyResolutions(ctx: MigrationContext, resolutions: readonly ResolvedConflict[]): Promise<void> {
  const { state } = ctx;
  const source = sourceGraph(ctx);
  const target = targetGraph(ctx);

  for (const { conflict, resolution } of resolutions) {
    const key = pageKey(conflict.subject);
    if (!state.selectedKeys.has(key)) {
      throw new MigrationAbortedError(`A resolution refers to "${conflict.subject}", which is not selected.`);
    }
    switch (resolution.kind) {
      case 'skip':
        state.skippedPages.add(key);
        break;
      case 'rename':
        if (resolution.newName.trim() === '') {
          throw new MigrationAbortedError(`Empty new name for "${conflict.subject}".`);
        }
        state.renames.set(key, resolution.newName.trim());
        break;
      case 'abort':
        throw new MigrationAbortedError('Migration aborted by user during conflict resolution.');
      default:
        throw new MigrationAbortedError(`Resolution "${resolution.kind}" is not valid for page "${conflict.subject}".`);
    }
  }

  state.movingKeys.clear();
  for (const key of state.selectedKeys) {
    if (!state.skippedPages.has(key)) {
      state.movingKeys.add(key);
    }
  }

  const targetFiles = new Set((await ctx.deps.fs.readDir(graphDir(ctx, target.graph, 'pagesDir'))).map((n) => n.toLowerCase()));
  const finalKeys = new Map<string, string>();
  const finalFiles = new Map<string, string>();
  for (const key of [...state.movingKeys].sort()) {
    const page = source.pages.get(key)!;
    const renamed = state.renames.get(key);
    const name = renamed ?? page.name;
    const fileName = (renamed === undefined ? page.fileName : pageNameToFileName(renamed)).toLowerCase();
    if (resolvePageKey(target, name) !== undefined || targetFiles.has(fileName)) {
      throw new MigrationAbortedError(`"${name}" still collides with an existing page in the target graph.`);
    }
    const sameName = finalKeys.get(pageKey(name)) ?? finalFiles.get(fileName);
    if (sameName !== undefined) {
      throw new MigrationAbortedError(`"${name}" and "${sameName}" would collide in the target graph.`);
    }
    finalKeys.set(pageKey(name), name);
    finalFiles.set(fileName, name);
  }
}

/** Step 3 (continued): pre-flight conflict detection, user resolution and plan validation. */
export async function detectAndResolveConflicts(ctx: MigrationContext): Promise<void> {
  const { state } = ctx;
  const conflicts = await detectConflicts(ctx);
  state.conflicts = conflicts;

  let resolutions: readonly ResolvedConflict[] = [];
  if (conflicts.length > 0) {
    resolutions = await ctx.deps.conflictResolver.resolve(conflicts);
    state.resolvedConflicts.push(...resolutions);
    if (!isCompleteResolution(conflicts, resolutions)) {
      throw new MigrationAbortedError('Not every conflict received a resolution.');
    }
    if (containsAbort(resolutions)) {
      throw new MigrationAbortedError('Migration aborted by user during conflict resolution.');
    }
  }

  await applyResolutions(ctx, resolutions);
  if (state.movingKeys.size === 0) {
    state.warnings.push('All selected pages were skipped; nothing will be moved.');
  }
}
