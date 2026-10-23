import { decodeText, encodeText } from '../fs/fileSystem';
import { joinPath } from '../fs/paths';
import type { GraphRef } from '../model/types';
import { pageKey } from '../parsing/pageNames';
import { graphId, scanGraph } from './graphScanner';
import {
  MigrationAbortedError,
  describeError,
  finalPageName,
  sortedMovingKeys,
  sourceGraph,
  targetGraph,
  type MigrationContext,
} from '../migration/migrationContext';
import { createTrackedFile, readTracked, replaceTrackedFile } from '../migration/trackedFiles';

export interface PersistedLocationIndex {
  readonly version: 1;
  readonly graphs: readonly { readonly name: string; readonly path: string; readonly pages: readonly string[] }[];
}

interface GraphEntry {
  graph: GraphRef;
  pages: Map<string, string>;
}

/**
 * Page Location Index: which pages live in which graph. Stored per graph (rather than as a flat
 * page -> graph map) so identically named pages in different graphs are represented faithfully.
 */
export class LocationIndex {
  private readonly entries = new Map<string, GraphEntry>();

  static fromJSON(data: unknown): LocationIndex {
    const index = new LocationIndex();
    const value = data as Partial<PersistedLocationIndex> | null;
    if (value?.version !== 1 || !Array.isArray(value.graphs)) {
      throw new Error('Unsupported page location index format.');
    }
    for (const entry of value.graphs) {
      if (typeof entry?.name !== 'string' || typeof entry.path !== 'string' || !Array.isArray(entry.pages)) {
        throw new Error('Malformed graph entry in page location index.');
      }
      index.setGraphPages({ name: entry.name, path: entry.path }, entry.pages.filter((p): p is string => typeof p === 'string'));
    }
    return index;
  }

  toJSON(): PersistedLocationIndex {
    return {
      version: 1,
      graphs: [...this.entries.values()]
        .map((e) => ({ name: e.graph.name, path: e.graph.path, pages: [...e.pages.values()].sort() }))
        .sort((a, b) => a.path.localeCompare(b.path)),
    };
  }

  registerGraph(graph: GraphRef): void {
    const id = graphId(graph.path);
    const entry = this.entries.get(id);
    if (entry === undefined) {
      this.entries.set(id, { graph, pages: new Map() });
    } else {
      entry.graph = graph;
    }
  }

  setGraphPages(graph: GraphRef, names: Iterable<string>): void {
    this.registerGraph(graph);
    this.entries.get(graphId(graph.path))!.pages = new Map([...names].map((n) => [pageKey(n), n]));
  }

  /** Adds graphs and pages from another index without replacing what is already known. */
  merge(other: LocationIndex): void {
    for (const [id, entry] of other.entries) {
      if (!this.entries.has(id)) {
        this.entries.set(id, { graph: entry.graph, pages: new Map(entry.pages) });
      }
    }
  }

  movePage(from: GraphRef, to: GraphRef, oldName: string, newName: string): void {
    const fromEntry = this.entries.get(graphId(from.path));
    if (fromEntry?.pages.delete(pageKey(oldName)) !== true) {
      throw new Error(`Page "${oldName}" is not indexed in ${from.path}.`);
    }
    this.registerGraph(to);
    this.entries.get(graphId(to.path))!.pages.set(pageKey(newName), newName);
  }

  has(graph: GraphRef, name: string): boolean {
    return this.entries.get(graphId(graph.path))?.pages.has(pageKey(name)) === true;
  }

  graphsContaining(name: string): GraphRef[] {
    const key = pageKey(name);
    return [...this.entries.values()].filter((e) => e.pages.has(key)).map((e) => e.graph);
  }

  knownGraphs(): GraphRef[] {
    return [...this.entries.values()].map((e) => e.graph);
  }
}

function indexFilePath(ctx: MigrationContext, graph: GraphRef): string {
  return joinPath(graph.path, ctx.request.layout.indexFile);
}

/**
 * Loads the persisted index from the source and target graphs, scans every other graph it knows
 * about (so their links into the moved pages can be regenerated), and refreshes it from disk.
 */
export async function loadLocationIndex(ctx: MigrationContext): Promise<void> {
  const { fs } = ctx.deps;
  const { state } = ctx;
  const source = sourceGraph(ctx);
  const target = targetGraph(ctx);
  const index = new LocationIndex();

  for (const graph of [source.graph, target.graph]) {
    const path = indexFilePath(ctx, graph);
    if (!(await fs.exists(path))) {
      continue;
    }
    state.existingIndexFiles.push(path);
    const bytes = await readTracked(ctx, path);
    try {
      index.merge(LocationIndex.fromJSON(JSON.parse(decodeText(bytes))));
    } catch (error) {
      state.warnings.push(`Ignoring unreadable page location index ${path}: ${describeError(error)}`);
    }
  }
  index.registerGraph(source.graph);
  index.registerGraph(target.graph);

  for (const known of index.knownGraphs()) {
    const id = graphId(known.path);
    if (state.graphs.has(id)) {
      continue;
    }
    if (await fs.isDirectory(known.path)) {
      const scanned = await scanGraph(fs, known, ctx.request.layout);
      state.graphs.set(id, scanned);
      for (const page of scanned.pages.values()) {
        state.fileHashes.set(page.filePath, page.sha256);
      }
    } else {
      state.warnings.push(`Known graph "${known.name}" was not found at ${known.path}; its links are not updated.`);
    }
  }

  const byName = new Map<string, string[]>();
  for (const scanned of state.graphs.values()) {
    index.setGraphPages(scanned.graph, [...scanned.pages.values()].map((p) => p.name));
    const name = scanned.graph.name.toLowerCase();
    byName.set(name, [...(byName.get(name) ?? []), scanned.graph.path]);
  }
  for (const [name, paths] of byName) {
    if (paths.length > 1) {
      if (name === target.graph.name.toLowerCase()) {
        throw new MigrationAbortedError(`Several graphs are named "${target.graph.name}" (${paths.join(', ')}); cross-graph links would be ambiguous.`);
      }
      state.warnings.push(`Several graphs share the name "${name}": ${paths.join(', ')}.`);
    }
  }
  state.locationIndex = index;
}

/** Step 5: record the new location of every moved page and persist the index into both graphs. */
export async function updatePageLocationIndex(ctx: MigrationContext): Promise<void> {
  const index = ctx.state.locationIndex;
  if (index === undefined) {
    throw new Error('Page location index has not been loaded.');
  }
  const source = sourceGraph(ctx);
  const target = targetGraph(ctx);
  for (const key of sortedMovingKeys(ctx)) {
    index.movePage(source.graph, target.graph, source.pages.get(key)!.name, finalPageName(ctx, key));
  }

  const bytes = encodeText(`${JSON.stringify(index.toJSON(), null, 2)}\n`);
  for (const graph of [source.graph, target.graph]) {
    const path = indexFilePath(ctx, graph);
    if (ctx.state.existingIndexFiles.includes(path)) {
      await replaceTrackedFile(ctx, path, bytes);
    } else {
      await createTrackedFile(ctx, path, bytes);
    }
  }
}
