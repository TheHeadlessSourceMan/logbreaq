import type { MigrationContext } from '../migration/migrationContext';

/** Step 5: record the new location of every moved page. Must run before link regeneration. */
export async function updatePageLocationIndex(_ctx: MigrationContext): Promise<void> {
  // TODO
}
