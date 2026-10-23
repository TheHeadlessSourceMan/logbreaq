import { sha256Hex } from '../fs/hash';
import { parentPath } from '../fs/paths';
import { IntegrityError, MigrationAbortedError, type MigrationContext } from './migrationContext';

/**
 * Reads a file and verifies it still has the content this run last saw,
 * detecting concurrent modification by Logseq, sync tools or the user.
 */
export async function readTracked(ctx: MigrationContext, path: string): Promise<Uint8Array> {
  const bytes = await ctx.deps.fs.readBytes(path);
  const actual = await sha256Hex(bytes);
  const expected = ctx.state.fileHashes.get(path);
  if (expected !== undefined && expected !== actual) {
    throw new MigrationAbortedError(`${path} was modified by another program during the migration.`);
  }
  ctx.state.fileHashes.set(path, actual);
  return bytes;
}

async function verifyWritten(ctx: MigrationContext, path: string, bytes: Uint8Array): Promise<string> {
  const expected = await sha256Hex(bytes);
  const actual = await sha256Hex(await ctx.deps.fs.readBytes(path));
  if (actual !== expected) {
    throw new IntegrityError([`Content of ${path} does not match what was written.`]);
  }
  return expected;
}

/** Creates a new file; fails if anything already exists at `path`. */
export async function createTrackedFile(ctx: MigrationContext, path: string, bytes: Uint8Array): Promise<string> {
  const { fs } = ctx.deps;
  await fs.mkdir(parentPath(path));
  await fs.writeBytes(path, bytes, { overwrite: false });
  // Recorded before verification so rollback removes it even if verification fails.
  ctx.state.createdFiles.set(path, await sha256Hex(bytes));
  const sha = await verifyWritten(ctx, path, bytes);
  ctx.state.fileHashes.set(path, sha);
  return sha;
}

/** Overwrites a file that this run either created or has backed up in the snapshot. */
export async function replaceTrackedFile(ctx: MigrationContext, path: string, bytes: Uint8Array): Promise<string> {
  const { state } = ctx;
  const created = state.createdFiles.has(path);
  const backedUp = state.snapshot?.entries.some((e) => e.originalPath === path) === true;
  if (!created && !backedUp) {
    throw new Error(`Refusing to overwrite ${path}: no backup exists.`);
  }
  await readTracked(ctx, path);
  await ctx.deps.fs.writeBytes(path, bytes, { overwrite: true });
  const sha = await sha256Hex(bytes);
  state.fileHashes.set(path, sha);
  if (created) {
    state.createdFiles.set(path, sha);
  }
  await verifyWritten(ctx, path, bytes);
  return sha;
}
