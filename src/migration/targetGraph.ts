import { isSamePath, joinPath } from '../fs/paths';
import { scanGraph } from '../indexing/graphScanner';
import { MigrationAbortedError, type MigrationContext } from './migrationContext';

/**
 * Step 3: create pages/, journals/, assets/, logseq/ if the target graph is missing.
 * An existing graph is never overwritten; an existing non-graph folder is rejected.
 */
export async function ensureTargetGraph(ctx: MigrationContext): Promise<void> {
  const { fs } = ctx.deps;
  const { request, state } = ctx;
  const { layout, targetGraph: target, sourceGraph: source } = request;

  if (isSamePath(target.path, source.path)) {
    throw new MigrationAbortedError('The target graph must differ from the source graph.');
  }
  if (target.name.toLowerCase() === source.name.toLowerCase()) {
    throw new MigrationAbortedError(`Source and target graphs are both named "${target.name}"; cross-graph links would be ambiguous.`);
  }

  const requiredDirs = [layout.pagesDir, layout.journalsDir, layout.assetsDir, layout.logseqDir].map((d) => joinPath(target.path, d));

  if (await fs.exists(target.path)) {
    if (!(await fs.isDirectory(target.path))) {
      throw new MigrationAbortedError(`Target path is a file, not a folder: ${target.path}`);
    }
    const isEmpty = (await fs.readDir(target.path)).length === 0;
    const looksLikeGraph =
      (await fs.isDirectory(joinPath(target.path, layout.pagesDir))) ||
      (await fs.isDirectory(joinPath(target.path, layout.logseqDir)));
    if (!isEmpty && !looksLikeGraph) {
      throw new MigrationAbortedError(`Target folder is not empty and is not a Logseq graph: ${target.path}`);
    }
    for (const dir of requiredDirs) {
      if ((await fs.exists(dir)) && !(await fs.isDirectory(dir))) {
        throw new MigrationAbortedError(`Expected a folder but found a file: ${dir}`);
      }
    }
  } else {
    state.targetGraphCreated = true;
  }

  for (const dir of requiredDirs) {
    if (!(await fs.exists(dir))) {
      await fs.mkdir(dir);
      ctx.deps.logger.info(`Created ${dir}`);
    }
  }

  const scanned = await scanGraph(fs, target, layout);
  state.graphs.set(scanned.id, scanned);
  for (const page of scanned.pages.values()) {
    state.fileHashes.set(page.filePath, page.sha256);
  }
}
