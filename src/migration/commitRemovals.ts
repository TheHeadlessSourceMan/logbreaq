import { sha256Hex } from '../fs/hash';
import { describeError, type MigrationContext } from './migrationContext';

/**
 * Final step, after integrity validation: delete source files that were moved.
 * A file is only deleted if it is unchanged and its verified copy still exists.
 * Failures are warnings: the worst outcome is a duplicate, never a loss.
 */
export async function commitRemovals(ctx: MigrationContext): Promise<void> {
  const { fs } = ctx.deps;
  const { state } = ctx;
  for (const path of state.pendingRemovals) {
    try {
      const copy = state.filesMoved.find((op) => op.from === path);
      const copyOk =
        copy !== undefined &&
        (await fs.exists(copy.to)) &&
        (await sha256Hex(await fs.readBytes(copy.to))) === state.fileHashes.get(copy.to);
      if (!copyOk) {
        state.warnings.push(`Kept ${path}: its copy in the target graph could not be verified.`);
        continue;
      }
      if ((await sha256Hex(await fs.readBytes(path))) !== state.fileHashes.get(path)) {
        state.warnings.push(`Kept ${path}: it was modified during the migration, so both copies were kept.`);
        continue;
      }
      await fs.remove(path);
    } catch (error) {
      state.warnings.push(`Could not remove ${path} (${describeError(error)}); it remains in the source graph.`);
    }
  }
}
