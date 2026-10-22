import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConflictResolver } from '../src/conflicts/conflictResolver';
import * as conflictDetection from '../src/conflicts/conflictDetection';
import { silentLogger } from '../src/logging/logger';
import type { MigrationDependencies } from '../src/migration/migrationContext';
import {
  MIGRATION_STEPS,
  SNAPSHOT_STEP_ID,
  runMigration,
  type MigrationStep,
} from '../src/migration/migrationWorkflow';
import { DEFAULT_GRAPH_LAYOUT, type Conflict, type MigrationRequest } from '../src/model/types';
import { LogseqUrlLinkRenderer } from '../src/rendering/linkRenderer';
import * as snapshot from '../src/rollback/snapshot';

const request: MigrationRequest = {
  id: 'req-1',
  sourceGraph: { name: 'A', path: '/graphs/A' },
  targetGraph: { name: 'B', path: '/graphs/B' },
  pages: ['Page X'],
  layout: DEFAULT_GRAPH_LAYOUT,
  requestedAt: new Date(0),
};

function deps(resolver?: ConflictResolver): MigrationDependencies {
  let t = 0;
  return {
    logger: silentLogger,
    linkRenderer: new LogseqUrlLinkRenderer(),
    conflictResolver: resolver ?? { resolve: async () => [] },
    now: () => (t += 5),
  };
}

function failingAt(stepId: string): MigrationStep[] {
  return MIGRATION_STEPS.map((step) =>
    step.id === stepId
      ? { ...step, run: async () => { throw new Error(`boom at ${stepId}`); } }
      : step,
  );
}

const conflict: Conflict = { kind: 'page-name', subject: 'Page X', existing: 'page x' };

afterEach(() => vi.restoreAllMocks());

describe('runMigration', () => {
  it('runs every workflow step in order and succeeds', async () => {
    const report = await runMigration(request, deps());
    expect(report.status).toBe('succeeded');
    expect(report.completedSteps).toEqual(MIGRATION_STEPS.map((s) => s.id));
    expect(report.errors).toEqual([]);
    expect(report.durationMs).toBe(5);
  });

  it('aborts without rollback when failing before the snapshot', async () => {
    const restore = vi.spyOn(snapshot, 'restoreSnapshot');
    const report = await runMigration(request, deps(), failingAt('verify-source-graph'));
    expect(report.status).toBe('aborted');
    expect(report.completedSteps).toEqual(['validate-source-pages']);
    expect(report.errors).toEqual(['Error: boom at verify-source-graph']);
    expect(restore).not.toHaveBeenCalled();
  });

  it('rolls back when failing after the snapshot', async () => {
    const restore = vi.spyOn(snapshot, 'restoreSnapshot');
    const report = await runMigration(request, deps(), failingAt('move-pages'));
    expect(report.status).toBe('rolled-back');
    expect(report.completedSteps).toContain(SNAPSHOT_STEP_ID);
    expect(report.completedSteps).not.toContain('move-pages');
    expect(restore).toHaveBeenCalledOnce();
  });

  it('reports rollback failure', async () => {
    vi.spyOn(snapshot, 'restoreSnapshot').mockRejectedValue(new Error('disk gone'));
    const report = await runMigration(request, deps(), failingAt('validate-integrity'));
    expect(report.status).toBe('rollback-failed');
    expect(report.errors).toEqual(['Error: boom at validate-integrity', 'Rollback failed: Error: disk gone']);
  });

  it('records non-Error throwables', async () => {
    const steps: MigrationStep[] = [{ id: 'x', title: 'x', run: () => Promise.reject('plain') }];
    const report = await runMigration(request, deps(), steps);
    expect(report.errors).toEqual(['plain']);
  });

  describe('conflict resolution', () => {
    it('continues when every conflict is resolved', async () => {
      vi.spyOn(conflictDetection, 'detectConflicts').mockResolvedValue([conflict]);
      const resolver: ConflictResolver = {
        resolve: async (cs) => cs.map((c) => ({ conflict: c, resolution: { kind: 'rename', newName: 'Page X (2)' } })),
      };
      const report = await runMigration(request, deps(resolver));
      expect(report.status).toBe('succeeded');
      expect(report.conflicts).toHaveLength(1);
    });

    it('aborts when the user chooses abort', async () => {
      vi.spyOn(conflictDetection, 'detectConflicts').mockResolvedValue([conflict]);
      const resolver: ConflictResolver = {
        resolve: async (cs) => cs.map((c) => ({ conflict: c, resolution: { kind: 'abort' } })),
      };
      const report = await runMigration(request, deps(resolver));
      expect(report.status).toBe('aborted');
      expect(report.errors[0]).toMatch(/aborted by user/);
    });

    it('aborts when a conflict is left unresolved', async () => {
      vi.spyOn(conflictDetection, 'detectConflicts').mockResolvedValue([conflict]);
      const report = await runMigration(request, deps({ resolve: async () => [] }));
      expect(report.status).toBe('aborted');
      expect(report.errors[0]).toMatch(/Not every conflict/);
    });
  });
});
