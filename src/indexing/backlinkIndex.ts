import { pageLinks } from '../parsing/pageParser';
import type { ScannedGraph } from './graphScanner';
import { resolveLinkTarget } from './linkResolution';
import { sortedMovingKeys, type AffectedPage, type MigrationContext } from '../migration/migrationContext';

/** Identity of the linked page -> pages linking to it (across all scanned graphs). */
export type BacklinkIndex = ReadonlyMap<string, ReadonlyMap<string, AffectedPage>>;

export function identityKey(graphIdValue: string, key: string): string {
  return `${graphIdValue}\u0000${key}`;
}

export function buildBacklinkIndex(graphs: ReadonlyMap<string, ScannedGraph>): BacklinkIndex {
  const index = new Map<string, Map<string, AffectedPage>>();
  for (const graph of graphs.values()) {
    for (const page of graph.pages.values()) {
      for (const node of pageLinks(page.nodes)) {
        const target = resolveLinkTarget(graphs, graph.id, node);
        if (target === undefined) {
          continue;
        }
        const id = identityKey(target.graphId, target.key);
        const linkers = index.get(id) ?? new Map<string, AffectedPage>();
        linkers.set(identityKey(graph.id, page.key), { graphId: graph.id, key: page.key });
        index.set(id, linkers);
      }
    }
  }
  return index;
}

/** Step 6: affected pages = moved pages + every page (in any scanned graph) linking to them. */
export async function determineAffectedPages(ctx: MigrationContext): Promise<void> {
  const { state } = ctx;
  const backlinks = buildBacklinkIndex(state.graphs);
  const affected = new Map<string, AffectedPage>();
  for (const key of sortedMovingKeys(ctx)) {
    affected.set(identityKey(state.sourceId, key), { graphId: state.sourceId, key });
    for (const [id, page] of backlinks.get(identityKey(state.sourceId, key)) ?? []) {
      affected.set(id, page);
    }
  }
  state.affectedPages = [...affected.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, page]) => page);
}
