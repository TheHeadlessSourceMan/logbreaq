import type { ConflictResolver } from '../conflicts/conflictResolver';
import type { Conflict, ResolvedConflict } from '../model/types';

/** UI-backed conflict resolver. Until the dialog exists, every conflict aborts (the safe default). */
export function createDialogConflictResolver(): ConflictResolver {
  return {
    async resolve(conflicts: readonly Conflict[]): Promise<readonly ResolvedConflict[]> {
      // TODO: present conflicts and collect skip / rename / abort choices from the user.
      return conflicts.map((conflict) => ({ conflict, resolution: { kind: 'abort' } }));
    },
  };
}
