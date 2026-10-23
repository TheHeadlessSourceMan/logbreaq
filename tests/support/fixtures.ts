import { encodeText } from '../../src/fs/fileSystem';
import { joinPath, parentPath } from '../../src/fs/paths';
import { silentLogger } from '../../src/logging/logger';
import { MIGRATION_STEPS } from '../../src/migration/migrationWorkflow';
import {
  createInitialState,
  type MigrationContext,
  type MigrationDependencies,
} from '../../src/migration/migrationContext';
import { DEFAULT_GRAPH_LAYOUT, type GraphRef, type MigrationRequest } from '../../src/model/types';
import { LogseqUrlLinkRenderer } from '../../src/rendering/linkRenderer';
import type { MemoryFileSystem } from './memoryFileSystem';

export const GRAPH_A: GraphRef = { name: 'GraphA', path: '/graphs/GraphA' };
export const GRAPH_B: GraphRef = { name: 'GraphB', path: '/graphs/GraphB' };
export const GRAPH_C: GraphRef = { name: 'GraphC', path: '/graphs/GraphC' };

export interface GraphSeed {
  readonly pages?: Record<string, string | Uint8Array>;
  readonly journals?: Record<string, string | Uint8Array>;
  readonly assets?: Record<string, string | Uint8Array>;
  /** Extra files relative to the graph root. */
  readonly files?: Record<string, string>;
}

export async function writeFile(fs: MemoryFileSystem, path: string, content: string | Uint8Array): Promise<void> {
  await fs.mkdir(parentPath(path));
  await fs.writeBytes(path, typeof content === 'string' ? encodeText(content) : content, { overwrite: true });
}

export async function seedGraph(fs: MemoryFileSystem, graph: GraphRef, seed: GraphSeed = {}): Promise<void> {
  const layout = DEFAULT_GRAPH_LAYOUT;
  for (const dir of [layout.pagesDir, layout.journalsDir, layout.assetsDir, layout.logseqDir]) {
    await fs.mkdir(joinPath(graph.path, dir));
  }
  const groups: [string, Record<string, string | Uint8Array> | undefined][] = [
    [layout.pagesDir, seed.pages],
    [layout.journalsDir, seed.journals],
    [layout.assetsDir, seed.assets],
    ['', seed.files],
  ];
  for (const [dir, files] of groups) {
    for (const [name, content] of Object.entries(files ?? {})) {
      await writeFile(fs, joinPath(graph.path, dir, name), content);
    }
  }
}

export function pagePath(graph: GraphRef, fileName: string): string {
  return joinPath(graph.path, DEFAULT_GRAPH_LAYOUT.pagesDir, fileName);
}

export function assetPath(graph: GraphRef, name: string): string {
  return joinPath(graph.path, DEFAULT_GRAPH_LAYOUT.assetsDir, name);
}

export function makeRequest(pages: readonly string[], overrides: Partial<MigrationRequest> = {}): MigrationRequest {
  return {
    id: 'req-1',
    sourceGraph: GRAPH_A,
    targetGraph: GRAPH_B,
    pages: [...pages],
    layout: DEFAULT_GRAPH_LAYOUT,
    requestedAt: new Date('2026-10-22T10:00:00Z'),
    ...overrides,
  };
}

export function makeDeps(fs: MemoryFileSystem, overrides: Partial<MigrationDependencies> = {}): MigrationDependencies {
  let clock = Date.parse('2026-10-22T10:00:00Z');
  return {
    fs,
    logger: silentLogger,
    linkRenderer: new LogseqUrlLinkRenderer(),
    conflictResolver: { resolve: async () => [] },
    now: () => (clock += 1000),
    ...overrides,
  };
}

export function makeContext(request: MigrationRequest, deps: MigrationDependencies): MigrationContext {
  return { request, deps, state: createInitialState(request) };
}

/** Runs the real workflow steps up to (not including) `stepId`. */
export async function runUntil(ctx: MigrationContext, stepId: string): Promise<void> {
  if (!MIGRATION_STEPS.some((s) => s.id === stepId)) {
    throw new Error(`Unknown step ${stepId}`);
  }
  for (const step of MIGRATION_STEPS) {
    if (step.id === stepId) {
      return;
    }
    await step.run(ctx);
  }
}

/** Runs the real workflow steps up to and including `stepId`. */
export async function runThrough(ctx: MigrationContext, stepId: string): Promise<void> {
  await runUntil(ctx, stepId);
  await MIGRATION_STEPS.find((s) => s.id === stepId)!.run(ctx);
}
