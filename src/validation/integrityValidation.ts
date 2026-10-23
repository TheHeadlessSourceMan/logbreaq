import { decodeText } from '../fs/fileSystem';
import { sha256Hex } from '../fs/hash';
import { assetReferences, findExistingAsset } from '../indexing/assetUsageIndex';
import { resolvePageKey } from '../indexing/graphScanner';
import { findGraphByName } from '../indexing/linkResolution';
import { pageKey } from '../parsing/pageNames';
import { pageLinks, parsePage } from '../parsing/pageParser';
import {
  IntegrityError,
  finalPageName,
  graphDir,
  isMovingPage,
  sortedMovingKeys,
  sourceGraph,
  targetGraph,
  type MigrationContext,
} from '../migration/migrationContext';

interface CheckedPage {
  readonly path: string;
  readonly graphId: string;
  readonly name: string;
  readonly moved: boolean;
}

/** Post-migration page existence, without rescanning. */
function createPostMigrationView(ctx: MigrationContext) {
  const { state } = ctx;
  const source = sourceGraph(ctx);
  const movedOut = new Set<string>();
  const movedIn = new Set<string>();
  for (const key of state.movingKeys) {
    const page = source.pages.get(key)!;
    movedOut.add(key);
    page.aliases.forEach((a) => movedOut.add(pageKey(a)));
    movedIn.add(pageKey(finalPageName(ctx, key)));
    page.aliases.forEach((a) => movedIn.add(pageKey(a)));
  }
  return {
    exists(graphIdValue: string, name: string): boolean {
      const key = pageKey(name);
      if (graphIdValue === state.targetId && movedIn.has(key)) {
        return true;
      }
      if (graphIdValue === state.sourceId && movedOut.has(key)) {
        return false;
      }
      const graph = state.graphs.get(graphIdValue);
      return graph !== undefined && resolvePageKey(graph, name) !== undefined;
    },
    movedAwayFrom(graphIdValue: string, name: string): boolean {
      return graphIdValue === state.sourceId && movedOut.has(pageKey(name));
    },
  };
}

function pagesToCheck(ctx: MigrationContext): CheckedPage[] {
  const { state } = ctx;
  const pages: CheckedPage[] = sortedMovingKeys(ctx).map((key) => ({
    path: state.movedPageTargets.get(key)!,
    graphId: state.targetId,
    name: finalPageName(ctx, key),
    moved: true,
  }));
  for (const { graphId, key } of state.affectedPages) {
    if (!isMovingPage(ctx, graphId, key)) {
      const page = state.graphs.get(graphId)!.pages.get(key)!;
      pages.push({ path: page.filePath, graphId, name: page.name, moved: false });
    }
  }
  return pages;
}

/**
 * Step 12: every written file exists with the expected hash; every page link in the moved and
 * backlink pages resolves to the right graph; every asset referenced by a moved page is reachable.
 * Problems introduced by this migration fail the run; pre-existing ones are reported as warnings.
 */
export async function runIntegrityValidation(ctx: MigrationContext): Promise<void> {
  const { fs } = ctx.deps;
  const { state } = ctx;
  const problems: string[] = [];
  const view = createPostMigrationView(ctx);

  for (const [path, sha] of state.createdFiles) {
    if (!(await fs.exists(path))) {
      problems.push(`Missing file: ${path}`);
    } else if ((await sha256Hex(await fs.readBytes(path))) !== sha) {
      problems.push(`Unexpected content in ${path}`);
    }
  }
  for (const operation of state.filesCopied) {
    if (!(await fs.exists(operation.from))) {
      problems.push(`Copied file's original disappeared: ${operation.from}`);
    }
  }

  const targetAssets = graphDir(ctx, targetGraph(ctx).graph, 'assetsDir');
  for (const page of pagesToCheck(ctx)) {
    if (!(await fs.exists(page.path))) {
      problems.push(`Missing page file: ${page.path}`);
      continue;
    }
    const bytes = await fs.readBytes(page.path);
    if ((await sha256Hex(bytes)) !== state.fileHashes.get(page.path)) {
      problems.push(`${page.path} changed unexpectedly during the migration.`);
      continue;
    }
    const nodes = parsePage(decodeText(bytes)).nodes;
    const generated = state.generatedLinks.get(page.path) ?? new Set<string>();
    const report = (message: string, raw: string): void => {
      if (generated.has(raw)) {
        problems.push(message);
      } else {
        state.warnings.push(`Pre-existing: ${message}`);
      }
    };

    for (const node of pageLinks(nodes)) {
      if (node.external === undefined) {
        if (view.movedAwayFrom(page.graphId, node.pageName) && !view.exists(page.graphId, node.pageName)) {
          problems.push(`"${page.name}" has a local link to "${node.pageName}", which now lives in another graph.`);
        }
        continue;
      }
      const graph = findGraphByName(state.graphs, node.external.graphName);
      if (graph === undefined) {
        report(`"${page.name}" links to unknown graph "${node.external.graphName}".`, node.raw);
      } else if (graph.id === page.graphId) {
        report(`"${page.name}" has an external link into its own graph: ${node.raw}`, node.raw);
      } else if (!view.exists(graph.id, node.pageName)) {
        report(`"${page.name}" links to "${node.pageName}", which does not exist in graph "${graph.graph.name}".`, node.raw);
      }
    }

    if (page.moved) {
      for (const { relName } of assetReferences(nodes)) {
        if ((await findExistingAsset(fs, targetAssets, relName)) === undefined) {
          if (state.missingAssets.has(relName.toLowerCase())) {
            state.warnings.push(`Pre-existing: asset "${relName}" referenced by "${page.name}" is missing.`);
          } else {
            problems.push(`Asset "${relName}" referenced by "${page.name}" is not in the target graph.`);
          }
        }
      }
    }
  }

  if (problems.length > 0) {
    throw new IntegrityError(problems);
  }
}
