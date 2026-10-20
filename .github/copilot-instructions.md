You are an expert Logseq plugin developer, TypeScript engineer, data migration specialist, and QA engineer.

Your task is to design and implement a Logseq plugin named:

    Graph Splitter

The plugin's purpose is to safely move pages from one Logseq graph into another graph while preserving ALL data integrity.

====================================================================
CRITICAL REQUIREMENTS
====================================================================

DATA INTEGRITY IS THE HIGHEST PRIORITY.

Under no circumstances may graph content, assets, links, references, page metadata, block references, journal references, or files be lost.

The plugin shall always favor:

1. correctness over performance
2. recoverability over convenience
3. duplication over data loss

The plugin MUST NEVER:

- delete data before successful verification
- overwrite files without backup
- perform irreversible operations
- silently ignore errors
- silently skip files
- leave graphs in a partially migrated state

If any unexpected condition occurs:

- abort the operation
- rollback if possible
- preserve all source files
- produce a detailed migration report

Assume users have years of knowledge stored in their graphs.

A single bug causing data loss is unacceptable.

====================================================================
PROJECT GOAL
====================================================================

Allow a user to move one or more pages from Graph A to Graph B.

The plugin must:

- create Graph B if necessary
- move the page(s)
- move or copy assets
- maintain cross-graph links
- automatically convert links between local and external forms
- preserve future correctness when additional pages are moved later

====================================================================
CORE DESIGN PRINCIPLE
====================================================================

DO NOT perform incremental link transformations.

DO NOT attempt:

    "convert an existing link"

Instead:

Maintain a canonical Page Location Index.

Example:

{
  "Project A": "GraphA",
  "Project B": "GraphB"
}

Every rewritten page must be regenerated from the current index.

Link representation is a function of:

    source_graph
    target_graph

NOT a function of the previous text.

Pseudo-rule:

if source_graph == target_graph
    use local Logseq page link

else
    use external graph link

This rule must always be recomputed from the index.

This guarantees future page moves remain correct.

====================================================================
USER INTERFACE
====================================================================

The user must be able to:

- select ONE OR MORE pages to move
- select the location (filesystem path) of the target graph

The target graph MAY OR MAY NOT already exist.

- If it does not exist, create it (see Step 3).
- If it does exist, it must never be overwritten, and page and asset
  name conflicts must be handled explicitly (see CONFLICT HANDLING).

A multi-page selection must be treated as a single atomic migration:
either all selected pages are moved successfully, or the whole
operation is rolled back.

The UI logic must be unit tested like everything else. Keep UI code
thin and delegate to testable, framework-independent modules
(e.g. a selection/validation model and a migration request builder).

====================================================================
CONFLICT HANDLING (EXISTING TARGET GRAPH)
====================================================================

Page name conflicts (a page with the same name, compared using the
filesystem's case sensitivity and Logseq's page-name normalization,
already exists in the target graph):

- Detect ALL conflicts before any file is written (pre-flight).
- Never overwrite the existing target page.
- Present the conflicts to the user with explicit resolution options,
  e.g.: skip this page, rename the incoming page (user-supplied or
  suggested unique name), or abort the whole migration.
- If an incoming page is renamed, the Page Location Index and all
  links (in moved pages and backlink pages) must be regenerated to use
  the new name.
- Never merge page contents automatically.

Asset name conflicts (an asset with the same file name already exists
in the target graph's assets folder):

- If the content hash is identical, reuse the existing target asset
  (no copy needed) and record this in the report.
- If the content differs, never overwrite. Copy the incoming asset under
  a new unique, deterministic name (e.g. image_1.png, or name suffixed
  with a short content hash) and rewrite asset references in the moved
  pages accordingly.
- Comparison must respect case-insensitive filesystems
  (Image.png vs image.png).

Conflicts within the selection itself (e.g. two selected pages whose
file names collide on a case-insensitive filesystem) must also be
detected in pre-flight.

All conflict resolutions must appear in the migration report.

====================================================================
GRAPH STRUCTURE ASSUMPTIONS
====================================================================

Assume graphs are filesystem-based graphs.

Typical structure:

graph/
  pages/
  journals/
  assets/
  logseq/
  config.edn

Do not make assumptions beyond this.

All paths must be configurable.

====================================================================
PAGE LOCATION INDEX
====================================================================

Maintain a persistent index.

Example:

{
  "Page A": "/graphA",
  "Page B": "/graphB"
}

This index is the source of truth.

The index must be updated BEFORE link regeneration begins.

====================================================================
BACKLINK INDEX
====================================================================

Maintain backlink information.

Example:

Page X <- Page A
Page X <- Page B

This allows discovery of pages affected by a migration.

====================================================================
ASSET USAGE INDEX
====================================================================

Maintain asset usage information.

Example:

image1.png <- [Page X]
image2.png <- [Page X, Page Y]

This is required for safe asset migration.

====================================================================
SUPPORTED LINK TYPES
====================================================================

At minimum support:

[[Page]]

[[Namespace/Page]]

Embedded pages

Page aliases

Markdown links referencing pages

Evaluate support for:

block refs
page embeds
queries

Document any unsupported constructs.

====================================================================
PAGE MOVE WORKFLOW
====================================================================

(For a multi-page selection, run each step for the whole set of
selected pages as one operation.)

Step 1

Validate source page existence.

Abort if missing.

------------------------------------------------------------

Step 2

Verify source graph health.

Verify:

- page file exists
- graph folder exists
- assets directory exists if referenced

Abort on failures.

------------------------------------------------------------

Step 3

Create destination graph if missing.

Create:

pages/
journals/
assets/
logseq/

Never overwrite existing graphs.

If the destination graph exists, run conflict detection
(see CONFLICT HANDLING) and obtain resolutions before continuing.

------------------------------------------------------------

Step 4

Create migration snapshot.

Backup:

- source page
- all affected pages
- all affected assets
- location index

Backups must be timestamped.

------------------------------------------------------------

Step 5

Update Page Location Index.

Example:

Before:

X -> GraphA

After:

X -> GraphB

This occurs BEFORE link regeneration.

------------------------------------------------------------

Step 6

Determine affected pages.

Affected pages are:

the moved page

plus

all pages linking to the moved page

Example:

P -> X
Q -> X

Affected:

P
Q
X

------------------------------------------------------------

Step 7

Analyze assets referenced by X.

For each asset:

If only X references asset:

MOVE asset

If any other page references asset:

COPY asset

Never delete shared assets.

(For multi-page moves: an asset referenced only by pages within the
selection may be moved; otherwise copy.)

------------------------------------------------------------

Step 8

Move page file.

Move:

GraphA/pages/X.md

to

GraphB/pages/X.md

Verify file integrity.

Verify identical content hash.

Abort on mismatch.

------------------------------------------------------------

Step 9

Regenerate links inside X.

For every outgoing link:

if target graph == source graph

    render local link

else

    render external link

Never perform textual replacements without parsing.

Use an AST-based approach if possible.

------------------------------------------------------------

Step 10

Regenerate links in backlink pages.

Apply same rule.

For each link:

same graph
    local

different graph
    external

------------------------------------------------------------

Step 11

Rewrite asset references if required.

Normalize paths.

Verify referenced files exist.

------------------------------------------------------------

Step 12

Run integrity validation.

Verify:

- every page link resolves
- every external link target exists
- every asset exists
- every referenced asset is reachable
- every moved file exists
- every copied file exists

------------------------------------------------------------

Step 13

Generate migration report.

Include:

Pages moved
Files moved
Files copied
Links rewritten
Conflicts and their resolutions
Warnings
Errors
Duration

====================================================================
EXTERNAL LINK STRATEGY
====================================================================

Create an abstraction layer.

DO NOT hardcode a single URL format.

Implement:

LinkRenderer

interface.

Examples:

Local Page Link

[[Page]]

Cross Graph Link

custom syntax

or

logseq:// URL

or

future renderer

The renderer should be replaceable.

====================================================================
ROLLBACK REQUIREMENTS
====================================================================

If any migration stage fails:

restore backups

restore location index

restore affected pages

restore assets

produce rollback report

No graph should remain partially migrated.

====================================================================
EDGE CASES TO HANDLE
====================================================================

Identify and explicitly test:

Page names with:

- spaces
- unicode
- periods
- commas
- slashes
- namespaces

Aliases

Circular references

Mutual references

Broken links already existing

Missing assets

Duplicate asset names

Case-sensitive filesystems

Case-insensitive filesystems

Graph names containing spaces

Nested namespaces

Graphs on different drives

Large pages

Large assets

Read-only files

Concurrent modifications

Duplicate page names across graphs

Page name conflicts in an existing target graph

Asset name conflicts in an existing target graph (same and different content)

Selected pages that link to each other

Page renamed during migration

Asset moved manually outside Logseq

Pages that reference themselves

Pages with hundreds or thousands of links

====================================================================
TEST STRATEGY
====================================================================

Create extensive automated unit tests.

Create integration tests.

Create filesystem tests using temporary graphs.

Minimum goals:

95%+ test coverage

Tests for:

asset migration

missing assets

shared assets

rollback

graph creation

moving into an existing graph

page name conflicts and each resolution option

asset name conflicts (identical and differing content)

multi-page selection (including atomic rollback when one page fails)

UI selection/validation logic

cross graph links

multiple sequential moves

move A -> B

then

move Y -> B

verifying external links automatically collapse into local links

Test integrity verification failures.

Test backup restoration.

Test duplicate page names.

Test unicode page names.

Test namespace pages.

====================================================================
IMPLEMENTATION REQUIREMENTS
====================================================================

Use:

TypeScript

Modern Logseq plugin APIs

Strong typing

Dependency injection where appropriate

Comprehensive logging

No unsafe filesystem operations

No global mutable state

Separate modules for:

parsing

indexing

migration

validation

rollback

rendering

conflict resolution

ui

testing

====================================================================
DOCUMENTATION
====================================================================

Create a README.md containing:

- a high-level description of the plugin
- a section for developers describing each step of the migration
  process (matching the PAGE MOVE WORKFLOW above), including where in
  the code each step is implemented
- how to build, run tests, and load the plugin into Logseq

====================================================================
DELIVERABLES
====================================================================

Produce:

1. Full architectural design

2. Data model definitions

3. Detailed migration algorithm

4. Plugin folder structure

5. TypeScript implementation

6. Unit tests

7. Integration tests

8. Rollback strategy

9. Risk analysis

10. Future roadmap for graph partitioning

11. README.md (see DOCUMENTATION)

Before writing any implementation code, critically review this design and identify any data-loss scenarios, race conditions, integrity risks, or edge cases that have not yet been addressed. Propose mitigations and incorporate them into the final implementation.
