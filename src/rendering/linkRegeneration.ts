import type { MigrationContext } from '../migration/migrationContext';

/** Step 9: regenerate every outgoing link in the moved pages from the location index. */
export async function regenerateLinksInMovedPages(_ctx: MigrationContext): Promise<void> {
  // TODO
}

/** Step 10: regenerate links to the moved pages in every backlink page. */
export async function regenerateLinksInBacklinkPages(_ctx: MigrationContext): Promise<void> {
  // TODO
}
