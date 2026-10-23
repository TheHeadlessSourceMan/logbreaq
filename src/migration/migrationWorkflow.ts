import type { MigrationReport, MigrationRequest, MigrationStatus } from '../model/types';
import { detectAndResolveConflicts } from '../conflicts/conflictResolution';
import { determineAffectedPages } from '../indexing/backlinkIndex';
import { planAssetMigration } from '../indexing/assetUsageIndex';
import { loadLocationIndex, updatePageLocationIndex } from '../indexing/pageLocationIndex';
import { regenerateLinksInBacklinkPages, regenerateLinksInMovedPages } from '../rendering/linkRegeneration';
import { buildReport } from '../reporting/migrationReport';
import { createSnapshot, restoreSnapshot } from '../rollback/snapshot';
import { runIntegrityValidation } from '../validation/integrityValidation';
import { validateSourcePages, verifySourceGraphHealth } from '../validation/sourceValidation';
import { rewriteAssetReferences, transferAssets } from './assetReferences';
import { commitRemovals } from './commitRemovals';
import {
  createInitialState,
  describeError,
  type MigrationContext,
  type MigrationDependencies,
} from './migrationContext';
import { movePageFiles } from './pageFiles';
import { ensureTargetGraph } from './targetGraph';

export interface MigrationStep {
  readonly id: string;
  readonly title: string;
  run(ctx: MigrationContext): Promise<void>;
}

/** Step id after which graph files may have changed and rollback is required on failure. */
export const SNAPSHOT_STEP_ID = 'create-snapshot';

/**
 * The PAGE MOVE WORKFLOW. Read-only analysis (steps 6 and 7) runs before the snapshot so the
 * snapshot can include every affected page and asset. Source files are deleted only after
 * integrity validation. Step 13 (report) is produced by runMigration itself.
 */
export const MIGRATION_STEPS: readonly MigrationStep[] = [
  { id: 'validate-source-pages', title: '1. Validate source pages', run: validateSourcePages },
  { id: 'verify-source-graph', title: '2. Verify source graph health', run: verifySourceGraphHealth },
  { id: 'ensure-target-graph', title: '3. Create target graph if missing', run: ensureTargetGraph },
  { id: 'resolve-conflicts', title: '3. Detect and resolve conflicts', run: detectAndResolveConflicts },
  { id: 'load-location-index', title: '5. Load page location index', run: loadLocationIndex },
  { id: 'determine-affected-pages', title: '6. Determine affected pages', run: determineAffectedPages },
  { id: 'plan-assets', title: '7. Analyze assets', run: planAssetMigration },
  { id: SNAPSHOT_STEP_ID, title: '4. Create migration snapshot', run: createSnapshot },
  { id: 'update-location-index', title: '5. Update page location index', run: updatePageLocationIndex },
  { id: 'move-pages', title: '8. Copy page files', run: movePageFiles },
  { id: 'transfer-assets', title: '8. Copy assets', run: transferAssets },
  { id: 'regenerate-moved-links', title: '9. Regenerate links in moved pages', run: regenerateLinksInMovedPages },
  { id: 'regenerate-backlinks', title: '10. Regenerate links in backlink pages', run: regenerateLinksInBacklinkPages },
  { id: 'rewrite-assets', title: '11. Rewrite asset references', run: rewriteAssetReferences },
  { id: 'validate-integrity', title: '12. Run integrity validation', run: runIntegrityValidation },
  { id: 'commit-removals', title: '12. Remove moved originals', run: commitRemovals },
];

/** Runs a migration atomically: all steps succeed, or the snapshot is restored. */
export async function runMigration(
  request: MigrationRequest,
  deps: MigrationDependencies,
  steps: readonly MigrationStep[] = MIGRATION_STEPS,
): Promise<MigrationReport> {
  const startedAt = deps.now();
  const ctx: MigrationContext = { request, deps, state: createInitialState(request) };
  const completedSteps: string[] = [];
  const errors: string[] = [];
  let status: MigrationStatus = 'succeeded';

  deps.logger.info(`Migration ${request.id} started`, { pages: request.pages, target: request.targetGraph.path });

  try {
    for (const step of steps) {
      deps.logger.info(`Running ${step.title}`);
      await step.run(ctx);
      completedSteps.push(step.id);
    }
  } catch (error) {
    errors.push(describeError(error));
    deps.logger.error(`Migration ${request.id} failed`, error);

    if (!completedSteps.includes(SNAPSHOT_STEP_ID)) {
      status = 'aborted';
      if (ctx.state.targetGraphCreated) {
        ctx.state.warnings.push(`The new, empty target graph folder was left at ${request.targetGraph.path}.`);
      }
    } else {
      try {
        await restoreSnapshot(ctx);
        status = 'rolled-back';
      } catch (rollbackError) {
        status = 'rollback-failed';
        errors.push(`Rollback failed: ${describeError(rollbackError)}`);
        deps.logger.error(`Rollback of migration ${request.id} failed`, rollbackError);
      }
    }
  }

  const report = buildReport({
    requestId: request.id,
    status,
    completedSteps,
    state: ctx.state,
    errors,
    durationMs: deps.now() - startedAt,
  });
  deps.logger.info(`Migration ${request.id} finished: ${status}`, report);
  return report;
}
