import type { MigrationContext } from '../migration/migrationContext';

/** Step 1: every selected page exists in the source graph. */
export async function validateSourcePages(_ctx: MigrationContext): Promise<void> {
  // TODO
}

/** Step 2: graph folder, page files and referenced asset folders exist. */
export async function verifySourceGraphHealth(_ctx: MigrationContext): Promise<void> {
  // TODO
}
