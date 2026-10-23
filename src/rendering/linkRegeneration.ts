import { decodeText, encodeText } from '../fs/fileSystem';
import type { PageFile } from '../indexing/graphScanner';
import { resolveLinkTarget } from '../indexing/linkResolution';
import type { LinkRewrite } from '../model/types';
import { pageKey } from '../parsing/pageNames';
import { parsePage, type PageLinkNode } from '../parsing/pageParser';
import {
  IntegrityError,
  finalPageName,
  isMovingPage,
  sortedMovingKeys,
  sourceGraph,
  type MigrationContext,
} from '../migration/migrationContext';
import { readTracked, replaceTrackedFile } from '../migration/trackedFiles';
import type { PageLinkSpec } from './linkRenderer';

export interface RegenerationResult {
  readonly content: string;
  readonly rewrites: readonly LinkRewrite[];
  readonly warnings: readonly string[];
}

/**
 * Renders one link from the post-migration location of its target. The output depends only on
 * the graph the linking page will live in and the graph the target will live in, never on the
 * link's previous text; the original text is kept verbatim when it already has the right form.
 */
function renderNode(
  ctx: MigrationContext,
  page: PageFile,
  node: PageLinkNode,
  pageGraphId: string,
  warnings: string[],
): string {
  const { state } = ctx;
  const identity = resolveLinkTarget(state.graphs, page.graphId, node);
  // Unknown graphs and file-less pages: nothing authoritative to regenerate from.
  if (identity === undefined || !identity.exists) {
    return node.raw;
  }

  const moving = isMovingPage(ctx, identity.graphId, identity.key);
  const destinationId = moving ? state.targetId : identity.graphId;
  const destination = state.graphs.get(destinationId)!.graph;
  const canonicalName = moving ? finalPageName(ctx, identity.key) : state.graphs.get(identity.graphId)!.pages.get(identity.key)!.name;
  if (state.locationIndex?.has(destination, canonicalName) !== true) {
    throw new IntegrityError([`Page location index does not place "${canonicalName}" in ${destination.path}.`]);
  }

  const renamedTo = moving ? state.renames.get(identity.key) : undefined;
  const pageName = renamedTo !== undefined && pageKey(node.pageName) === identity.key ? renamedTo : node.pageName;
  const spec: PageLinkSpec = { pageName, kind: node.kind, ...(node.label !== undefined ? { label: node.label } : {}) };

  if (destinationId === pageGraphId) {
    return node.external === undefined && node.pageName === pageName ? node.raw : ctx.deps.linkRenderer.renderLocal(spec);
  }
  if (node.external?.graphName === destination.name && node.pageName === pageName) {
    return node.raw;
  }
  if (node.kind === 'embed') {
    warnings.push(`Embed of "${pageName}" in "${page.name}" is shown as a link because embeds cannot cross graphs.`);
  }
  return ctx.deps.linkRenderer.renderExternal(spec, destination);
}

export function regenerateLinks(
  ctx: MigrationContext,
  page: PageFile,
  content: string,
  pageGraphId: string,
  displayName: string,
): RegenerationResult {
  const rewrites: LinkRewrite[] = [];
  const warnings: string[] = [];
  const output = parsePage(content).nodes.map((node) => {
    if (node.type !== 'page-link') {
      return node.raw;
    }
    const rendered = renderNode(ctx, page, node, pageGraphId, warnings);
    if (rendered !== node.raw) {
      rewrites.push({ page: displayName, before: node.raw, after: rendered });
    }
    return rendered;
  });
  return { content: output.join(''), rewrites, warnings };
}

async function regenerateFile(
  ctx: MigrationContext,
  page: PageFile,
  path: string,
  pageGraphId: string,
  displayName: string,
): Promise<void> {
  const { state } = ctx;
  const content = decodeText(await readTracked(ctx, path));
  const result = regenerateLinks(ctx, page, content, pageGraphId, displayName);
  state.warnings.push(...result.warnings);
  if (result.content === content) {
    return;
  }
  await replaceTrackedFile(ctx, path, encodeText(result.content));
  state.linksRewritten.push(...result.rewrites);
  const generated = state.generatedLinks.get(path) ?? new Set<string>();
  for (const rewrite of result.rewrites) {
    generated.add(rewrite.after);
  }
  state.generatedLinks.set(path, generated);
}

/** Step 9: regenerate every outgoing link in the moved pages. */
export async function regenerateLinksInMovedPages(ctx: MigrationContext): Promise<void> {
  const source = sourceGraph(ctx);
  for (const key of sortedMovingKeys(ctx)) {
    const path = ctx.state.movedPageTargets.get(key)!;
    await regenerateFile(ctx, source.pages.get(key)!, path, ctx.state.targetId, finalPageName(ctx, key));
  }
}

/** Step 10: regenerate links in every page (in any scanned graph) that links to a moved page. */
export async function regenerateLinksInBacklinkPages(ctx: MigrationContext): Promise<void> {
  const { state } = ctx;
  for (const { graphId, key } of state.affectedPages) {
    if (isMovingPage(ctx, graphId, key)) {
      continue;
    }
    const page = state.graphs.get(graphId)!.pages.get(key)!;
    await regenerateFile(ctx, page, page.filePath, graphId, page.name);
  }
}
