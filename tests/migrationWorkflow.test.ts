import { describe, expect, it } from 'vitest';
import type { ConflictResolver } from '../src/conflicts/conflictResolver';
import { MIGRATION_STEPS, SNAPSHOT_STEP_ID, runMigration, type MigrationStep } from '../src/migration/migrationWorkflow';
import { GRAPH_A, GRAPH_B, makeDeps, makeRequest, pagePath, seedGraph } from './support/fixtures';
import { MemoryFileSystem } from './support/memoryFileSystem';

async function setup(b: Parameters<typeof seedGraph>[2] = {}) {
  const fs = new MemoryFileSystem();
  await seedGraph(fs, GRAPH_A, { pages: { 'X.md': '- [[Y]]', 'Y.md': '- [[X]]' } });
  if (Object.keys(b).length > 0) {
    await seedGraph(fs, GRAPH_B, b);
  }
  return fs;
}

function failingAt(stepId: string): MigrationStep[] {
  return MIGRATION_STEPS.map((step) =>
    step.id === stepId
      ? { ...step, run: async () => { throw new Error(`boom at ${stepId}`); } }
      : step,
  );
}

function resolveAll(resolution: 'abort' | 'skip'): ConflictResolver {
  return { resolve: async (cs) => cs.map((conflict) => ({ conflict, resolution: { kind: resolution } })) };
}

describe('runMigration', () => {
  it('runs every workflow step in order and succeeds', async () => {
    const fs = await setup();
    const report = await runMigration(makeRequest(['X']), makeDeps(fs));
    expect(report.status).toBe('succeeded');
    expect(report.completedSteps).toEqual(MIGRATION_STEPS.map((s) => s.id));
    expect(report.errors).toEqual([]);
    expect(report.pagesMoved).toEqual(['X']);
    expect(report.durationMs).toBeGreaterThan(0);
  });

  it('aborts without touching anything when failing before the snapshot', async () => {
    const fs = await setup();
    const report = await runMigration(makeRequest(['X']), makeDeps(fs), failingAt('verify-source-graph'));
    expect(report.status).toBe('aborted');
    expect(report.completedSteps).toEqual(['validate-source-pages']);
    expect(report.errors).toEqual(['Error: boom at verify-source-graph']);
    expect(report.rollbackLog).toEqual([]);
    expect(await fs.exists(GRAPH_B.path)).toBe(false);
  });

  it('mentions a newly created target folder that was left behind on abort', async () => {
    const fs = await setup();
    const report = await runMigration(makeRequest(['X']), makeDeps(fs), failingAt('load-location-index'));
    expect(report.status).toBe('aborted');
    expect(report.warnings).toContain(`The new, empty target graph folder was left at ${GRAPH_B.path}.`);
  });

  it('rolls back when failing after the snapshot', async () => {
    const fs = await setup();
    const report = await runMigration(makeRequest(['X']), makeDeps(fs), failingAt('regenerate-backlinks'));
    expect(report.status).toBe('rolled-back');
    expect(report.completedSteps).toContain(SNAPSHOT_STEP_ID);
    expect(report.rollbackLog).toContain(`Removed ${pagePath(GRAPH_B, 'X.md')}`);
    expect(fs.has(pagePath(GRAPH_B, 'X.md'))).toBe(false);
    expect(fs.text(pagePath(GRAPH_A, 'X.md'))).toBe('- [[Y]]');
  });

  it('reports rollback failure', async () => {
    const fs = await setup();
    const steps = failingAt('validate-integrity');
    fs.failOn = (op) => op === 'remove';
    const report = await runMigration(makeRequest(['X']), makeDeps(fs), steps);
    expect(report.status).toBe('rollback-failed');
    expect(report.errors[0]).toBe('Error: boom at validate-integrity');
    expect(report.errors[1]).toMatch(/^Rollback failed: Error: Rollback incomplete/);
  });

  it('records non-Error throwables', async () => {
    const fs = await setup();
    const steps: MigrationStep[] = [{ id: 'x', title: 'x', run: () => Promise.reject('plain') }];
    const report = await runMigration(makeRequest(['X']), makeDeps(fs), steps);
    expect(report.errors).toEqual(['plain']);
  });

  describe('conflict resolution', () => {
    it('skips conflicting pages and reports the resolution', async () => {
      const fs = await setup({ pages: { 'X.md': '- B version' } });
      const report = await runMigration(makeRequest(['X', 'Y']), makeDeps(fs, { conflictResolver: resolveAll('skip') }));
      expect(report.status).toBe('succeeded');
      expect(report.pagesMoved).toEqual(['Y']);
      expect(report.conflicts).toEqual([
        { conflict: { kind: 'page-name', subject: 'X', existing: 'X' }, resolution: { kind: 'skip' } },
      ]);
      expect(fs.text(pagePath(GRAPH_B, 'X.md'))).toBe('- B version');
    });

    it('aborts when the user chooses abort', async () => {
      const fs = await setup({ pages: { 'X.md': '- B version' } });
      const report = await runMigration(makeRequest(['X']), makeDeps(fs, { conflictResolver: resolveAll('abort') }));
      expect(report.status).toBe('aborted');
      expect(report.errors[0]).toMatch(/aborted by user/);
    });
  });
});
