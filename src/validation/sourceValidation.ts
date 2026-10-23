import { joinPath } from '../fs/paths';
import { scanGraph } from '../indexing/graphScanner';
import { assetReferences, findExistingAsset } from '../indexing/assetUsageIndex';
import { pageKey } from '../parsing/pageNames';
import { MigrationAbortedError, graphDir, sourceGraph, type MigrationContext } from '../migration/migrationContext';
import { readTracked } from '../migration/trackedFiles';

/** Step 1: every selected page exists in the source graph and is a regular (non-journal) page. */
export async function validateSourcePages(ctx: MigrationContext): Promise<void> {
  const { fs } = ctx.deps;
  const { request, state } = ctx;
  if (request.pages.length === 0) {
    throw new MigrationAbortedError('No pages were selected.');
  }
  if (!(await fs.isDirectory(request.sourceGraph.path))) {
    throw new MigrationAbortedError(`Source graph folder not found: ${request.sourceGraph.path}`);
  }

  const source = await scanGraph(fs, request.sourceGraph, request.layout);
  state.graphs.set(source.id, source);
  for (const page of source.pages.values()) {
    state.fileHashes.set(page.filePath, page.sha256);
  }

  const missing: string[] = [];
  const journals: string[] = [];
  for (const name of request.pages) {
    const page = source.pages.get(pageKey(name));
    if (page === undefined) {
      missing.push(name);
    } else if (page.folder === 'journals') {
      journals.push(name);
    } else {
      state.selectedKeys.add(page.key);
    }
  }
  if (missing.length > 0) {
    throw new MigrationAbortedError(`Page(s) not found in the source graph: ${missing.join(', ')}`);
  }
  if (journals.length > 0) {
    throw new MigrationAbortedError(`Journal pages cannot be moved: ${journals.join(', ')}`);
  }
}

/** Step 2: page files are present and unchanged, names are unambiguous and referenced assets are reachable. */
export async function verifySourceGraphHealth(ctx: MigrationContext): Promise<void> {
  const { fs } = ctx.deps;
  const { request, state } = ctx;
  const source = sourceGraph(ctx);

  if (!(await fs.isDirectory(joinPath(source.graph.path, request.layout.pagesDir)))) {
    throw new MigrationAbortedError(`Pages folder missing in source graph ${source.graph.path}`);
  }

  for (const group of source.duplicates) {
    const files = group.map((p) => p.filePath).join(', ');
    if (state.selectedKeys.has(group[0]!.key)) {
      throw new MigrationAbortedError(`Page "${group[0]!.name}" is defined by several files: ${files}`);
    }
    state.warnings.push(`Duplicate page "${group[0]!.name}" in ${files}; links to it are resolved to ${group[0]!.filePath}.`);
  }

  const assetsDir = graphDir(ctx, source.graph, 'assetsDir');
  const assetsDirExists = await fs.isDirectory(assetsDir);
  for (const key of [...state.selectedKeys].sort()) {
    const page = source.pages.get(key)!;
    if (!(await fs.exists(page.filePath))) {
      throw new MigrationAbortedError(`Page file disappeared: ${page.filePath}`);
    }
    await readTracked(ctx, page.filePath);

    for (const { relName } of assetReferences(page.nodes)) {
      if (!assetsDirExists) {
        throw new MigrationAbortedError(`"${page.name}" references assets but ${assetsDir} does not exist.`);
      }
      if ((await findExistingAsset(fs, assetsDir, relName)) === undefined) {
        const lower = relName.toLowerCase();
        if (!state.missingAssets.has(lower)) {
          state.missingAssets.add(lower);
          state.warnings.push(`Asset "${relName}" referenced by "${page.name}" is missing; the reference is kept unchanged.`);
        }
      }
    }
  }
}
