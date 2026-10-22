import type { MigrationContext } from '../migration/migrationContext';

/** Step 4: timestamped backup of moved pages, affected pages, affected assets and the location index. */
export async function createSnapshot(_ctx: MigrationContext): Promise<void> {
  // TODO
}

/** Restores every file and the location index from the snapshot (if one was taken). */
export async function restoreSnapshot(_ctx: MigrationContext): Promise<void> {
  // TODO
}
