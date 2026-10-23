import { decodeText, encodeText } from '../fs/fileSystem';
import { sha256Hex } from '../fs/hash';
import { pageNameToFileName } from '../parsing/pageNames';
import { extractPageProperties, replaceTitleProperty } from '../parsing/pageProperties';
import {
  IntegrityError,
  finalPageName,
  graphDir,
  sortedMovingKeys,
  sourceGraph,
  targetGraph,
  type MigrationContext,
} from './migrationContext';
import { createTrackedFile, readTracked } from './trackedFiles';
import { joinPath } from '../fs/paths';

/**
 * Step 8: copy each page file into the target graph and verify its content hash.
 * Source files are only queued for removal; they are deleted after integrity validation.
 */
export async function movePageFiles(ctx: MigrationContext): Promise<void> {
  const { state } = ctx;
  const source = sourceGraph(ctx);
  const targetPages = graphDir(ctx, targetGraph(ctx).graph, 'pagesDir');

  for (const key of sortedMovingKeys(ctx)) {
    const page = source.pages.get(key)!;
    const name = finalPageName(ctx, key);
    const renamed = state.renames.has(key);
    const original = await readTracked(ctx, page.filePath);

    let bytes = original;
    if (renamed && extractPageProperties(page.content).has('title')) {
      bytes = encodeText(replaceTitleProperty(decodeText(original), name));
    }
    const targetPath = joinPath(targetPages, renamed ? pageNameToFileName(name) : page.fileName);
    const sha256 = await createTrackedFile(ctx, targetPath, bytes);
    if (!renamed && sha256 !== (await sha256Hex(original))) {
      throw new IntegrityError([`Hash mismatch after copying ${page.filePath} to ${targetPath}`]);
    }

    state.movedPageTargets.set(key, targetPath);
    state.filesMoved.push({ from: page.filePath, to: targetPath, sha256 });
    state.pendingRemovals.push(page.filePath);
    state.pagesMoved.push(name);
  }
}
