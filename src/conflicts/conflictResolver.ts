import type { Conflict, ResolvedConflict } from '../model/types';

/** Supplies a resolution for every conflict; implemented by the UI layer. */
export interface ConflictResolver {
  resolve(conflicts: readonly Conflict[]): Promise<readonly ResolvedConflict[]>;
}

export function containsAbort(resolutions: readonly ResolvedConflict[]): boolean {
  return resolutions.some((r) => r.resolution.kind === 'abort');
}

/** Every conflict must have exactly one resolution; anything else is treated as abort. */
export function isCompleteResolution(
  conflicts: readonly Conflict[],
  resolutions: readonly ResolvedConflict[],
): boolean {
  return (
    conflicts.length === resolutions.length &&
    conflicts.every((c) => resolutions.some((r) => r.conflict === c))
  );
}
