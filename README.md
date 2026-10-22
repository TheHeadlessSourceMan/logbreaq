# logbreaq — Graph Splitter for Logseq

Break parts of Logseq graphs off into smaller graphs.

> **THIS IS A WORK-IN-PROGRESS — NOT READY FOR USE!!!**
> The UI and migration pipeline are scaffolded; the individual migration steps are still empty stubs.

Graph Splitter is a Logseq plugin that moves one or more pages from the current (file-based)
graph into another graph, creating that graph if needed. Moved pages keep working links:
links between pages in the same graph are rendered as `[[Page]]`; links that cross graphs are
rendered as external `logseq://graph/...` links. Link text is always regenerated from a canonical
Page Location Index, never patched incrementally. A multi-page move is atomic: it either fully
succeeds or is rolled back from a snapshot.

## Usage

Open the dialog via any of:

- the toolbar button,
- the command palette: **Graph Splitter: Move pages to another graph**,
- a page's context menu: **Graph Splitter: Move this page to another graph** (pre-selects that page).

Select pages, enter the absolute path of the target graph folder, and click **Move pages**.

## Developers

### Migration workflow

The orchestrator is `runMigration()` in [src/migration/migrationWorkflow.ts](src/migration/migrationWorkflow.ts).
It runs `MIGRATION_STEPS` in order on a per-run `MigrationContext`. If a step fails before the
snapshot exists, the migration is **aborted** (nothing changed). If it fails afterwards, the
snapshot is restored (**rolled-back**, or **rollback-failed** if restoring fails).

| Step | Description | Implementation |
| ---- | ----------- | -------------- |
| 1 | Validate source pages exist | `validateSourcePages` — [src/validation/sourceValidation.ts](src/validation/sourceValidation.ts) |
| 2 | Verify source graph health | `verifySourceGraphHealth` — [src/validation/sourceValidation.ts](src/validation/sourceValidation.ts) |
| 3 | Create target graph if missing | `ensureTargetGraph` — [src/migration/targetGraph.ts](src/migration/targetGraph.ts) |
| 3 | Pre-flight conflict detection + resolution | `detectConflicts` — [src/conflicts/conflictDetection.ts](src/conflicts/conflictDetection.ts); `detectAndResolveConflicts` — [src/migration/migrationWorkflow.ts](src/migration/migrationWorkflow.ts) |
| 4 | Create timestamped snapshot | `createSnapshot` — [src/rollback/snapshot.ts](src/rollback/snapshot.ts) |
| 5 | Update Page Location Index | `updatePageLocationIndex` — [src/indexing/pageLocationIndex.ts](src/indexing/pageLocationIndex.ts) |
| 6 | Determine affected pages | `determineAffectedPages` — [src/indexing/backlinkIndex.ts](src/indexing/backlinkIndex.ts) |
| 7 | Analyze assets (move / copy / reuse) | `planAssetMigration` — [src/indexing/assetUsageIndex.ts](src/indexing/assetUsageIndex.ts) |
| 8 | Move page files + hash verification | `movePageFiles` — [src/migration/pageFiles.ts](src/migration/pageFiles.ts) |
| 9 | Regenerate links in moved pages | `regenerateLinksInMovedPages` — [src/rendering/linkRegeneration.ts](src/rendering/linkRegeneration.ts) |
| 10 | Regenerate links in backlink pages | `regenerateLinksInBacklinkPages` — [src/rendering/linkRegeneration.ts](src/rendering/linkRegeneration.ts) |
| 11 | Rewrite asset references | `rewriteAssetReferences` — [src/migration/assetReferences.ts](src/migration/assetReferences.ts) |
| 12 | Integrity validation | `runIntegrityValidation` — [src/validation/integrityValidation.ts](src/validation/integrityValidation.ts) |
| 13 | Migration report | `buildReport` — [src/reporting/migrationReport.ts](src/reporting/migrationReport.ts) |
| — | Rollback | `restoreSnapshot` — [src/rollback/snapshot.ts](src/rollback/snapshot.ts) |

Supporting modules:

- [src/model/types.ts](src/model/types.ts) — data model (requests, indexes, conflicts, reports).
- [src/rendering/linkRenderer.ts](src/rendering/linkRenderer.ts) — replaceable `LinkRenderer` and the local/external rule.
- [src/parsing/pageParser.ts](src/parsing/pageParser.ts) — page AST (stub).
- [src/ui/selectionModel.ts](src/ui/selectionModel.ts) — framework-independent selection/validation model.
- [src/migration/migrationRequest.ts](src/migration/migrationRequest.ts) — builds a `MigrationRequest` from the UI selection.
- [src/ui/mainDialog.ts](src/ui/mainDialog.ts) — thin DOM view; [src/main.ts](src/main.ts) — Logseq entry point.

### Build, test, load

Requires Node.js 18+.

```sh
npm install
npm test          # unit tests (vitest)
npm run coverage  # tests with coverage
npm run build     # typecheck + production build into dist/
```

To load in Logseq Desktop:

1. Settings → Advanced → enable **Developer mode**.
2. Plugins (`t p`) → **Load unpacked plugin**.
3. Select this repository folder (the one containing `package.json`, not `dist/`).

For live development, run `npm run dev` and load the plugin the same way; `vite-plugin-logseq` enables hot reload.