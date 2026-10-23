import { resolvePageKey } from '../indexing/graphScanner';
import type { Conflict } from '../model/types';
import { graphDir, sourceGraph, targetGraph, type MigrationContext } from '../migration/migrationContext';

/**
 * Pre-flight: detects page-name collisions with the target graph (by Logseq page identity,
 * including aliases, and by case-insensitive file name) and file-name collisions within the
 * selection. Runs before any page or asset is written.
 */
export async function detectConflicts(ctx: MigrationContext): Promise<Conflict[]> {
  const { fs } = ctx.deps;
  const { state } = ctx;
  const source = sourceGraph(ctx);
  const target = targetGraph(ctx);
  const targetFiles = new Map(
    (await fs.readDir(graphDir(ctx, target.graph, 'pagesDir'))).map((name) => [name.toLowerCase(), name] as const),
  );
  const conflicts: Conflict[] = [];
  const selectedFiles = new Map<string, string>();

  for (const key of [...state.selectedKeys].sort()) {
    const page = source.pages.get(key)!;
    const existingKey = resolvePageKey(target, page.name);
    const fileClash = targetFiles.get(page.fileName.toLowerCase());
    if (existingKey !== undefined) {
      conflicts.push({ kind: 'page-name', subject: page.name, existing: target.pages.get(existingKey)!.name });
    } else if (fileClash !== undefined) {
      conflicts.push({ kind: 'page-name', subject: page.name, existing: fileClash, detail: 'A file with the same name exists in the target pages folder.' });
    }

    const lowerFile = page.fileName.toLowerCase();
    const previous = selectedFiles.get(lowerFile);
    if (previous !== undefined) {
      conflicts.push({ kind: 'selection-collision', subject: page.name, existing: previous, detail: 'Both selected pages would get the same file name.' });
    } else {
      selectedFiles.set(lowerFile, page.name);
    }

    for (const alias of page.aliases) {
      const clash = resolvePageKey(target, alias);
      if (clash !== undefined) {
        state.warnings.push(`Alias "${alias}" of "${page.name}" also names "${target.pages.get(clash)!.name}" in the target graph.`);
      }
    }
  }
  return conflicts;
}
