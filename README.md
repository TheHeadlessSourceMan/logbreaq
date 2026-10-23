# logbreaq — Graph Splitter for Logseq

Break parts of Logseq graphs off into smaller graphs.

> **THIS IS A WORK-IN-PROGRESS — NOT READY FOR USE!!!**
> The migration pipeline is implemented and tested against an in-memory filesystem, but no
> platform filesystem adapter exists yet: inside Logseq every migration aborts at step 1.

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

Deviations from the original design, made for safety:

- Steps 6 and 7 are read-only and run **before** the snapshot (step 4), so the snapshot can contain
  every affected page and asset.
- Step 8 *copies*; moved originals are deleted only by a final commit step after integrity validation,
  and only if both the original and its copy are unchanged. A failed delete leaves a duplicate, never a loss.
- Every write goes through [src/migration/trackedFiles.ts](src/migration/trackedFiles.ts): new files are
  never overwritten, existing files are only replaced if backed up, and every read/write is
  hash-checked to detect concurrent modification.

| Step | Description | Implementation |
| ---- | ----------- | -------------- |
| 1 | Validate source pages exist (non-journal) | `validateSourcePages` — [src/validation/sourceValidation.ts](src/validation/sourceValidation.ts) |
| 2 | Verify source graph health (duplicates, unchanged files, assets folder) | `verifySourceGraphHealth` — [src/validation/sourceValidation.ts](src/validation/sourceValidation.ts) |
| 3 | Create target graph if missing; reject non-graph folders | `ensureTargetGraph` — [src/migration/targetGraph.ts](src/migration/targetGraph.ts) |
| 3 | Pre-flight conflict detection + resolution | `detectConflicts` — [src/conflicts/conflictDetection.ts](src/conflicts/conflictDetection.ts); `detectAndResolveConflicts` — [src/conflicts/conflictResolution.ts](src/conflicts/conflictResolution.ts) |
| 5a | Load the Page Location Index and scan every known graph | `loadLocationIndex` — [src/indexing/pageLocationIndex.ts](src/indexing/pageLocationIndex.ts) |
| 6 | Determine affected pages (backlinks across all known graphs) | `determineAffectedPages` — [src/indexing/backlinkIndex.ts](src/indexing/backlinkIndex.ts) |
| 7 | Analyze assets (move / copy / reuse / rename) | `planAssetMigration` — [src/indexing/assetUsageIndex.ts](src/indexing/assetUsageIndex.ts) |
| 4 | Create verified, timestamped snapshot | `createSnapshot` — [src/rollback/snapshot.ts](src/rollback/snapshot.ts) |
| 5 | Update and persist the Page Location Index | `updatePageLocationIndex` — [src/indexing/pageLocationIndex.ts](src/indexing/pageLocationIndex.ts) |
| 8 | Copy page files + hash verification | `movePageFiles` — [src/migration/pageFiles.ts](src/migration/pageFiles.ts) |
| 8 | Copy assets | `transferAssets` — [src/migration/assetReferences.ts](src/migration/assetReferences.ts) |
| 9 | Regenerate links in moved pages | `regenerateLinksInMovedPages` — [src/rendering/linkRegeneration.ts](src/rendering/linkRegeneration.ts) |
| 10 | Regenerate links in backlink pages | `regenerateLinksInBacklinkPages` — [src/rendering/linkRegeneration.ts](src/rendering/linkRegeneration.ts) |
| 11 | Rewrite asset references | `rewriteAssetReferences` — [src/migration/assetReferences.ts](src/migration/assetReferences.ts) |
| 12 | Integrity validation | `runIntegrityValidation` — [src/validation/integrityValidation.ts](src/validation/integrityValidation.ts) |
| 12 | Delete moved originals | `commitRemovals` — [src/migration/commitRemovals.ts](src/migration/commitRemovals.ts) |
| 13 | Migration report | `buildReport` — [src/reporting/migrationReport.ts](src/reporting/migrationReport.ts) |
| — | Rollback | `restoreSnapshot` — [src/rollback/snapshot.ts](src/rollback/snapshot.ts) |

Supporting modules:

- [src/model/types.ts](src/model/types.ts) — data model (requests, conflicts, snapshots, reports).
- [src/fs/fileSystem.ts](src/fs/fileSystem.ts) — the `FileSystem` abstraction every step uses.
- [src/parsing/pageParser.ts](src/parsing/pageParser.ts) — lossless tokenizer for Logseq Markdown.
- [src/indexing/graphScanner.ts](src/indexing/graphScanner.ts) — reads pages, titles, aliases and journals.
- [src/rendering/linkRenderer.ts](src/rendering/linkRenderer.ts) — replaceable `LinkRenderer` and the local/external rule.
- [src/ui/selectionModel.ts](src/ui/selectionModel.ts) — framework-independent selection/validation model.
- [src/migration/migrationRequest.ts](src/migration/migrationRequest.ts) — builds a `MigrationRequest` from the UI selection.
- [src/ui/mainDialog.ts](src/ui/mainDialog.ts) — thin DOM view; [src/main.ts](src/main.ts) — Logseq entry point.

### Link handling

| Construct | Support |
| --------- | ------- |
| `[[Page]]`, `[[Namespace/Page]]`, `[label]([[Page]])` | Regenerated |
| `#tag`, `#[[Tag]]` | Regenerated; external form `[#tag](logseq://…)` collapses back to a tag |
| `{{embed [[Page]]}}` | Regenerated; across graphs becomes a link with `&embed=true` (warning) and collapses back to an embed |
| Aliases (`alias::`) | Resolved to their page; the alias text is kept |
| `title::` | Used as the page name; updated when an incoming page is renamed |
| Asset links `../assets/…` | Moved/copied/reused; renamed on content conflicts; paths normalized |
| Block refs `((uuid))`, queries, other macros, code | Left untouched (block refs do not work across graphs) |
| Unbracketed property values (`tags:: a, b`) | Not rewritten |
| `.org` pages, YAML front matter, custom file name formats | Not supported |
| Links from graphs not recorded in the Page Location Index | Not updated |

### Build, test, load

Requires Node.js 20+ (tests use the global Web Crypto API).

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