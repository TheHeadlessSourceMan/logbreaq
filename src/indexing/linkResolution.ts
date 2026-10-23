import type { PageLinkNode } from '../parsing/pageParser';
import { pageKey } from '../parsing/pageNames';
import { resolvePageKey, type ScannedGraph } from './graphScanner';

export interface PageIdentity {
  readonly graphId: string;
  readonly key: string;
  /** False for pages that are only referenced and have no file in that graph. */
  readonly exists: boolean;
}

/** Finds a scanned graph by its (case-insensitive) name; undefined if unknown or ambiguous. */
export function findGraphByName(graphs: ReadonlyMap<string, ScannedGraph>, name: string): ScannedGraph | undefined {
  const matches = [...graphs.values()].filter((g) => g.graph.name.toLowerCase() === name.toLowerCase());
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Resolves the page a link points to, in the context of the graph the linking page lives in.
 * Returns undefined for external links into graphs that were not scanned.
 */
export function resolveLinkTarget(
  graphs: ReadonlyMap<string, ScannedGraph>,
  fromGraphId: string,
  node: PageLinkNode,
): PageIdentity | undefined {
  const graph = node.external !== undefined ? findGraphByName(graphs, node.external.graphName) : graphs.get(fromGraphId);
  if (graph === undefined) {
    return undefined;
  }
  const key = resolvePageKey(graph, node.pageName);
  return key !== undefined
    ? { graphId: graph.id, key, exists: true }
    : { graphId: graph.id, key: pageKey(node.pageName), exists: false };
}
