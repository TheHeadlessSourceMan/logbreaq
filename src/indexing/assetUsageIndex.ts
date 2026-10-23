import type { FileSystem } from '../fs/fileSystem';
import { sha256Hex } from '../fs/hash';
import { joinPath, splitExtension } from '../fs/paths';
import type { AssetAction, AssetActionKind } from '../model/types';
import type { AssetNode, PageNode } from '../parsing/pageParser';
import type { ScannedGraph } from './graphScanner';
import {
  graphDir,
  sortedMovingKeys,
  sourceGraph,
  targetGraph,
  type MigrationContext,
} from '../migration/migrationContext';

/** Lower-cased asset path (relative to the assets folder) -> keys of pages referencing it. */
export type AssetUsageIndex = ReadonlyMap<string, ReadonlySet<string>>;

const ASSET_PREFIX = /^(?:\.\.\/|\.\/|\/)?assets\//;

/** `../assets/sub/my%20file.png?x` -> `sub/my file.png`. */
export function assetRelName(path: string): string {
  const relative = path.replace(ASSET_PREFIX, '').replace(/[?#].*$/, '');
  try {
    return decodeURI(relative);
  } catch {
    return relative;
  }
}

export function assetReferences(nodes: readonly PageNode[]): { node: AssetNode; relName: string }[] {
  return nodes
    .filter((n): n is AssetNode => n.type === 'asset')
    .map((node) => ({ node, relName: assetRelName(node.path) }));
}

export function buildAssetUsageIndex(graph: ScannedGraph): AssetUsageIndex {
  const usage = new Map<string, Set<string>>();
  for (const page of graph.pages.values()) {
    for (const { relName } of assetReferences(page.nodes)) {
      const lower = relName.toLowerCase();
      const users = usage.get(lower) ?? new Set<string>();
      users.add(page.key);
      usage.set(lower, users);
    }
  }
  return usage;
}

/**
 * Finds `relName` below `assetsDir`, preferring an exact-case match and falling back to a
 * case-insensitive one (so Image.png and image.png are treated as the same file).
 * Returns the on-disk relative name.
 */
export async function findExistingAsset(fs: FileSystem, assetsDir: string, relName: string): Promise<string | undefined> {
  const actual: string[] = [];
  let dir = assetsDir;
  for (const part of relName.split('/')) {
    if (!(await fs.isDirectory(dir))) {
      return undefined;
    }
    const entries = await fs.readDir(dir);
    const match = entries.find((e) => e === part) ?? entries.find((e) => e.toLowerCase() === part.toLowerCase());
    if (match === undefined) {
      return undefined;
    }
    actual.push(match);
    dir = joinPath(dir, match);
  }
  return (await fs.isDirectory(dir)) ? undefined : actual.join('/');
}

/** Deterministic alternative name for a differing asset: `name_<hash8>.ext`, then `name_<hash8>_2.ext`, ... */
export function uniqueAssetName(relName: string, sha256: string, attempt: number): string {
  const { stem, ext } = splitExtension(relName);
  const suffix = attempt === 0 ? sha256.slice(0, 8) : `${sha256.slice(0, 8)}_${attempt + 1}`;
  return `${stem}_${suffix}${ext}`;
}

/**
 * Step 7: plan asset handling for the moving pages.
 * Move if every referencing page moves, otherwise copy; reuse identical files already in the target.
 */
export async function planAssetMigration(ctx: MigrationContext): Promise<void> {
  const { fs } = ctx.deps;
  const { state } = ctx;
  const source = sourceGraph(ctx);
  const sourceAssets = graphDir(ctx, source.graph, 'assetsDir');
  const targetAssets = graphDir(ctx, targetGraph(ctx).graph, 'assetsDir');
  const usage = buildAssetUsageIndex(source);
  const plannedTargets = new Set<string>();
  const seen = new Set<string>();
  const actions: AssetAction[] = [];

  for (const key of sortedMovingKeys(ctx)) {
    for (const { relName } of assetReferences(source.pages.get(key)!.nodes)) {
      const actual = await findExistingAsset(fs, sourceAssets, relName);
      if (actual === undefined || seen.has(actual)) {
        continue;
      }
      seen.add(actual);

      const sourcePath = joinPath(sourceAssets, actual);
      const sha256 = await sha256Hex(await fs.readBytes(sourcePath));
      state.fileHashes.set(sourcePath, sha256);

      const users = usage.get(actual.toLowerCase()) ?? new Set<string>();
      let action: AssetActionKind = [...users].every((k) => state.movingKeys.has(k)) ? 'move' : 'copy';
      let targetName = actual;
      let clashedWith: string | undefined;

      for (let attempt = 0; ; attempt += 1) {
        const existing = await findExistingAsset(fs, targetAssets, targetName);
        if (existing === undefined && !plannedTargets.has(targetName.toLowerCase())) {
          break;
        }
        if (existing !== undefined && (await sha256Hex(await fs.readBytes(joinPath(targetAssets, existing)))) === sha256) {
          action = 'reuse';
          targetName = existing;
          state.resolvedConflicts.push({
            conflict: { kind: 'asset-name', subject: actual, existing },
            resolution: { kind: 'reuse-existing-asset' },
          });
          break;
        }
        clashedWith ??= existing ?? targetName;
        targetName = uniqueAssetName(actual, sha256, attempt);
      }

      if (action !== 'reuse' && clashedWith !== undefined) {
        state.resolvedConflicts.push({
          conflict: { kind: 'asset-name', subject: actual, existing: clashedWith, detail: 'Different content.' },
          resolution: { kind: 'copy-asset-as', newName: targetName },
        });
      }

      plannedTargets.add(targetName.toLowerCase());
      actions.push({ asset: actual, sourcePath, action, targetName, targetPath: joinPath(targetAssets, targetName), sha256 });
    }
  }
  state.assetActions = actions;
}
