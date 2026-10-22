import type { MigrationContext } from '../migration/migrationContext';

/** Step 6: affected pages = moved pages + every page linking to them. */
export async function determineAffectedPages(_ctx: MigrationContext): Promise<void> {
  // TODO
}
