import { decodeText, encodeText } from '../fs/fileSystem';
import { assetRelName } from '../indexing/assetUsageIndex';
import type { AssetAction } from '../model/types';
import { parsePage } from '../parsing/pageParser';
import { IntegrityError, finalPageName, sortedMovingKeys, type MigrationContext } from './migrationContext';
import { createTrackedFile, readTracked, replaceTrackedFile } from './trackedFiles';

const NORMALIZED_PREFIX = '../assets/';

/** Step 8 (assets): copy planned assets into the target graph. Moved originals are removed after validation. */
export async function transferAssets(ctx: MigrationContext): Promise<void> {
  const { state } = ctx;
  for (const action of state.assetActions) {
    if (action.action === 'reuse') {
      continue;
    }
    const bytes = await readTracked(ctx, action.sourcePath);
    const sha256 = await createTrackedFile(ctx, action.targetPath, bytes);
    if (sha256 !== action.sha256) {
      throw new IntegrityError([`Hash mismatch after copying ${action.sourcePath}`]);
    }
    const operation = { from: action.sourcePath, to: action.targetPath, sha256 };
    if (action.action === 'move') {
      state.filesMoved.push(operation);
      state.pendingRemovals.push(action.sourcePath);
    } else {
      state.filesCopied.push(operation);
    }
  }
}

export function findAssetAction(actions: readonly AssetAction[], relName: string): AssetAction | undefined {
  return actions.find((a) => a.asset === relName) ?? actions.find((a) => a.asset.toLowerCase() === relName.toLowerCase());
}

function encodeAssetPath(relName: string): string {
  return relName.replace(/[ %()<>]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** Step 11: point asset links in moved pages at their (possibly renamed) target files using `../assets/`. */
export async function rewriteAssetReferences(ctx: MigrationContext): Promise<void> {
  const { fs } = ctx.deps;
  const { state } = ctx;
  for (const key of sortedMovingKeys(ctx)) {
    const path = state.movedPageTargets.get(key)!;
    const content = decodeText(await readTracked(ctx, path));
    const used: AssetAction[] = [];
    const output = parsePage(content).nodes.map((node) => {
      if (node.type !== 'asset') {
        return node.raw;
      }
      const relName = assetRelName(node.path);
      const action = findAssetAction(state.assetActions, relName);
      if (action === undefined) {
        return node.raw;
      }
      used.push(action);
      if (action.targetName === relName && node.path.startsWith(NORMALIZED_PREFIX)) {
        return node.raw;
      }
      const rewritten = `${node.isEmbed ? '!' : ''}[${node.label}](${NORMALIZED_PREFIX}${encodeAssetPath(action.targetName)}${node.title})`;
      state.linksRewritten.push({ page: finalPageName(ctx, key), before: node.raw, after: rewritten });
      return rewritten;
    });

    for (const action of used) {
      if (!(await fs.exists(action.targetPath))) {
        throw new IntegrityError([`Asset ${action.targetPath} referenced by "${finalPageName(ctx, key)}" does not exist.`]);
      }
    }
    const updated = output.join('');
    if (updated !== content) {
      await replaceTrackedFile(ctx, path, encodeText(updated));
    }
  }
}
