import type { MigrationContext } from '../migration/migrationContext';

/**
 * Step 7: plan asset handling. Move if referenced only by selected pages,
 * otherwise copy; reuse identical existing target assets.
 */
export async function planAssetMigration(_ctx: MigrationContext): Promise<void> {
  // TODO
}
