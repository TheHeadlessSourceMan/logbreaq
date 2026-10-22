import type { Conflict } from '../model/types';
import type { MigrationContext } from '../migration/migrationContext';

/**
 * Pre-flight: detects page-name, asset-name and intra-selection collisions
 * before any file is written.
 */
export async function detectConflicts(_ctx: MigrationContext): Promise<Conflict[]> {
  // TODO: implement conflict detection.
  return [];
}
