import { encodeText } from '../fs/fileSystem';
import { sha256Hex } from '../fs/hash';
import { baseName, joinPath, parentPath } from '../fs/paths';
import type { SnapshotEntry } from '../model/types';
import {
  MigrationAbortedError,
  describeError,
  sortedMovingKeys,
  sourceGraph,
  type MigrationContext,
} from '../migration/migrationContext';
import { readTracked } from '../migration/trackedFiles';

function sequenceName(index: number, path: string): string {
  return `${String(index).padStart(4, '0')}_${baseName(path)}`;
}

/** Every existing file the migration may modify or delete. */
function filesToBackUp(ctx: MigrationContext): string[] {
  const { state } = ctx;
  const source = sourceGraph(ctx);
  const paths = new Set<string>();
  for (const key of sortedMovingKeys(ctx)) {
    paths.add(source.pages.get(key)!.filePath);
  }
  for (const { graphId, key } of state.affectedPages) {
    const page = state.graphs.get(graphId)?.pages.get(key);
    if (page !== undefined) {
      paths.add(page.filePath);
    }
  }
  for (const action of state.assetActions) {
    if (action.action === 'move') {
      paths.add(action.sourcePath);
    }
  }
  for (const path of state.existingIndexFiles) {
    paths.add(path);
  }
  return [...paths];
}

/**
 * Step 4: timestamped, verified backup of moved pages, affected pages, moved assets and the
 * location index, plus a manifest.json describing how to restore them by hand.
 */
export async function createSnapshot(ctx: MigrationContext): Promise<void> {
  const { fs } = ctx.deps;
  const { request } = ctx;
  const createdAt = new Date(ctx.deps.now());
  const stamp = createdAt.toISOString().replace(/[:.]/g, '-');
  const backupDir = joinPath(request.sourceGraph.path, request.layout.backupDir, `${stamp}_${request.id}`);
  if (await fs.exists(backupDir)) {
    throw new MigrationAbortedError(`Backup folder already exists: ${backupDir}`);
  }

  const entries: SnapshotEntry[] = [];
  for (const [index, originalPath] of filesToBackUp(ctx).entries()) {
    const bytes = await readTracked(ctx, originalPath);
    const sha256 = await sha256Hex(bytes);
    const backupPath = joinPath(backupDir, 'files', sequenceName(index, originalPath));
    await fs.mkdir(parentPath(backupPath));
    await fs.writeBytes(backupPath, bytes, { overwrite: false });
    if ((await sha256Hex(await fs.readBytes(backupPath))) !== sha256) {
      throw new MigrationAbortedError(`Backup verification failed for ${originalPath}`);
    }
    entries.push({ originalPath, backupPath, sha256 });
  }

  const manifest = {
    requestId: request.id,
    createdAt: createdAt.toISOString(),
    sourceGraph: request.sourceGraph,
    targetGraph: request.targetGraph,
    pages: request.pages,
    entries,
  };
  await fs.mkdir(backupDir);
  await fs.writeBytes(joinPath(backupDir, 'manifest.json'), encodeText(`${JSON.stringify(manifest, null, 2)}\n`), { overwrite: false });
  ctx.state.snapshot = { id: request.id, createdAt, backupDir, entries };
}

/**
 * Restores every backed-up file and removes files created by the migration.
 * Content that changed concurrently is copied to `<backupDir>/conflicted/` first, so nothing is lost.
 */
export async function restoreSnapshot(ctx: MigrationContext): Promise<void> {
  const { fs } = ctx.deps;
  const { state } = ctx;
  const { snapshot } = state;
  if (snapshot === undefined) {
    state.rollbackLog.push('No snapshot was taken; nothing to restore.');
    return;
  }

  const problems: string[] = [];
  let preserved = 0;
  const preserve = async (path: string, bytes: Uint8Array): Promise<void> => {
    const copy = joinPath(snapshot.backupDir, 'conflicted', sequenceName(preserved++, path));
    await fs.mkdir(parentPath(copy));
    await fs.writeBytes(copy, bytes, { overwrite: false });
    state.rollbackLog.push(`Preserved concurrently modified ${path} as ${copy}`);
  };

  for (const [path, sha] of [...state.createdFiles].reverse()) {
    try {
      if (!(await fs.exists(path))) {
        state.rollbackLog.push(`Created file already gone: ${path}`);
        continue;
      }
      const bytes = await fs.readBytes(path);
      if ((await sha256Hex(bytes)) !== sha) {
        await preserve(path, bytes);
      }
      await fs.remove(path);
      state.rollbackLog.push(`Removed ${path}`);
    } catch (error) {
      problems.push(`Could not remove ${path}: ${describeError(error)}`);
    }
  }

  for (const entry of snapshot.entries) {
    try {
      const backup = await fs.readBytes(entry.backupPath);
      if ((await sha256Hex(backup)) !== entry.sha256) {
        throw new Error(`backup ${entry.backupPath} is corrupt`);
      }
      if (await fs.exists(entry.originalPath)) {
        const current = await fs.readBytes(entry.originalPath);
        const currentSha = await sha256Hex(current);
        if (currentSha === entry.sha256) {
          state.rollbackLog.push(`Unchanged ${entry.originalPath}`);
          continue;
        }
        const lastWritten = state.fileHashes.get(entry.originalPath);
        if (lastWritten === entry.sha256) {
          // The migration never changed this file, so the difference is someone else's edit.
          state.rollbackLog.push(`Left ${entry.originalPath} as modified by another program`);
          continue;
        }
        if (currentSha !== lastWritten) {
          await preserve(entry.originalPath, current);
        }
      } else {
        await fs.mkdir(parentPath(entry.originalPath));
      }
      await fs.writeBytes(entry.originalPath, backup, { overwrite: true });
      if ((await sha256Hex(await fs.readBytes(entry.originalPath))) !== entry.sha256) {
        throw new Error('restored content does not match the backup');
      }
      state.rollbackLog.push(`Restored ${entry.originalPath}`);
    } catch (error) {
      problems.push(`Could not restore ${entry.originalPath}: ${describeError(error)}`);
    }
  }

  if (problems.length > 0) {
    state.rollbackLog.push(...problems);
    throw new Error(`Rollback incomplete; backups remain in ${snapshot.backupDir}:\n- ${problems.join('\n- ')}`);
  }
}
