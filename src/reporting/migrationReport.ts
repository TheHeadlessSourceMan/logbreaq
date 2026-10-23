import type { MigrationReport, MigrationStatus } from '../model/types';
import type { MigrationState } from '../migration/migrationContext';

export interface ReportInput {
  readonly requestId: string;
  readonly status: MigrationStatus;
  readonly completedSteps: readonly string[];
  readonly state: MigrationState;
  readonly errors: readonly string[];
  readonly durationMs: number;
}

/** Step 13: assemble the migration report. */
export function buildReport(input: ReportInput): MigrationReport {
  const { state } = input;
  return {
    requestId: input.requestId,
    status: input.status,
    completedSteps: [...input.completedSteps],
    pagesMoved: [...state.pagesMoved],
    filesMoved: [...state.filesMoved],
    filesCopied: [...state.filesCopied],
    linksRewritten: [...state.linksRewritten],
    conflicts: [...state.resolvedConflicts],
    warnings: [...state.warnings],
    errors: [...input.errors],
    rollbackLog: [...state.rollbackLog],
    durationMs: input.durationMs,
  };
}
