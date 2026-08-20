# Cross-Worktree Intelligence Design

## Summary

Cross-Worktree Intelligence is a dedicated Mission Control screen for understanding how parallel Codex and OpenCode worktrees interact. It analyzes local Git changes across eligible worktrees, extracts TypeScript and JavaScript symbols, identifies deterministic file/module/symbol relationships, persists normalized intelligence in SQLite, and exposes typed IPC contracts to the renderer.

The feature is not another worktree inventory. Its purpose is to answer three operational questions:

1. Which agents are changing related code?
2. Which relationships require intervention before merge?
3. Which worktrees are safely independent?

The analysis remains local. Risk classifications come from Git diffs, changed source ranges, normalized paths, and AST declarations—not model-generated guesses.

## Scope

### Included

- A dedicated **Intelligence** top-level sidebar entry and route.
- Repository-scoped analysis of worktrees that have a coding-agent session and either a non-empty task delta or an active session that has not produced changes yet.
- Complete task deltas from merge-base through committed, staged, unstaged, and untracked changes.
- Changed files, folders, module paths, additions, deletions, patches, and changed source ranges.
- Deterministic TS/TSX/JS/JSX symbol extraction through the installed TypeScript compiler API.
- File-, module-, symbol-, and meaningful-folder overlap detection.
- Low, medium, and high risk classification.
- Safely independent worktree classification.
- Actionable Attention items.
- Persisted normalized intelligence snapshots in SQLite.
- Typed IPC APIs and refresh events.
- Overlap inspection, two-worktree diff comparison, and direct navigation to the relevant coding-agent chat.

### Excluded

- Fabricated execution-completion percentages or progress estimates.
- AI-generated conflict predictions.
- Permanent filesystem watchers.
- Symbol-level parsing for languages other than TypeScript and JavaScript in the first version.
- Automatic conflict resolution, rebasing, merging, or destructive Git operations.
- Cross-repository overlap analysis.

## Product Behavior

### Eligibility

Analysis is performed independently for a selected repository. A worktree is eligible when it has at least one coding-agent session and either:

- its task delta is non-empty; or
- its latest session is active or waiting and has not produced its first edit yet.

The latest session supplies agent identity, task title, status, activity metadata, and chat navigation. The Git working tree remains the source of truth for code changes, including manual edits and changes from earlier sessions.

### Change Range

For each worktree, the collector finds the merge-base between its branch and configured base branch. The analyzed delta covers:

- committed changes from merge-base through `HEAD`;
- staged changes;
- unstaged changes; and
- untracked files.

This represents the complete task branch rather than only the latest agent turn or uncommitted state.

### Mission Control Screen

The screen follows the existing Electron renderer shell and design tokens. It contains:

1. A repository selector, snapshot freshness indicator, and manual refresh control.
2. Summary cards for eligible worktrees, shared overlaps, highest risk, and independent worktrees.
3. A central overlap map showing up to four worktrees at once around the overlap engine.
4. A compact Attention panel containing only actionable issues.
5. Focused detail and diff-comparison surfaces opened from the map or Attention panel.

Each worktree node presents:

- task title and branch;
- Codex or OpenCode identity;
- current agent status;
- currently changed files and symbols;
- additions and deletions;
- latest deterministic activity metadata; and
- independent or overlap state.

No percentage-complete value is shown unless an agent API supplies a real value in a future version.

When more than four worktrees are eligible, deterministic pagination limits each map view to four nodes. Attention ordering remains repository-wide.

## Main Process Architecture

### WorktreeIntelligenceService

`WorktreeIntelligenceService` is the orchestration boundary for one repository analysis. It owns refresh serialization, snapshot lifecycle, error aggregation, and DTO assembly. It depends on four focused units.

### Git Change Collector

The collector:

- resolves and validates the worktree context;
- verifies that all file access remains inside the worktree root;
- determines the merge-base against the configured base branch;
- obtains name status, numstat, and zero-context patches through explicit Git commands;
- includes committed, staged, unstaged, and untracked content;
- normalizes path separators and Git rename paths;
- records source and destination paths for rename collision checks;
- calculates additions, deletions, change type, changed ranges, and patch content;
- derives meaningful folder and module ancestry; and
- excludes ignored, generated, binary, dependency, and Git-internal content.

Untracked text files are represented as additions from an empty source. Binary files may retain file-level overlap metadata but do not persist text patches or symbol records.

### TypeScript Symbol Analyzer

The analyzer supports `.ts`, `.tsx`, `.js`, and `.jsx` through the TypeScript compiler API already installed by the project. It extracts declarations with stable qualified identities:

- functions;
- methods;
- classes;
- interfaces;
- type aliases;
- enums;
- variable declarations initialized with executable functions; and
- relevant object or class members.

Changed diff ranges are mapped to the smallest enclosing declaration. A malformed or unsupported source file falls back to file/module analysis without failing the snapshot.

### Overlap Classifier

The classifier compares normalized worktree analyses pairwise. It applies rules from most specific to least specific and records every target that contributes to the resulting relationship.

#### High risk

- The same qualified TS/JS symbol is modified by both worktrees.
- Changed line ranges overlap in the same file.
- Both worktrees replace or delete the same original source range.

#### Medium risk

- The same file is modified in distinct, non-overlapping symbols or ranges.
- Related files are modified inside the same nearest meaningful module folder.
- Three or more worktrees modify one module.

#### Low risk

- Worktrees share only a broader meaningful folder ancestor while modifying distinct files and modules.

#### Independent

- No file, module, symbol, or meaningful-folder relationship exists with any other eligible worktree.

Risk is never inferred from task titles or natural-language agent output.

### Intelligence Repository

A dedicated database repository persists and loads intelligence data. The service computes a candidate snapshot in memory, then replaces the repository's current snapshot in one SQLite transaction. A failed refresh never deletes the last successful snapshot.

### Refresh Scheduling

Refreshes occur when:

- the Intelligence screen requests repository data;
- the user selects Refresh; or
- debounced coding-agent events indicate status or diff activity.

Refreshes are serialized per repository. Multiple requests for the same repository share the in-flight promise. Separate repositories may analyze independently within a small concurrency limit. No permanent filesystem watcher is introduced.

## Persistence Model

Database definitions remain centralized in `src/shared/db/schema.ts`. Drizzle generates migration artifacts; generated migrations are not edited manually.

### `intelligence_snapshots`

Stores:

- snapshot ID;
- repository ID;
- lifecycle status;
- started, completed, and source timestamps;
- source metadata used for freshness;
- worktree-scoped warning summary; and
- created/updated timestamps.

Only a completed snapshot becomes current for a repository.

### `intelligence_worktrees`

Stores:

- snapshot ID and worktree ID;
- latest run/session ID when present;
- agent kind, agent name, and status;
- task title, branch, and base branch;
- additions, deletions, and changed-file totals;
- latest activity timestamp;
- independent flag; and
- worktree-scoped analysis warning.

### `intelligence_changed_files`

Stores:

- intelligence-worktree ID;
- normalized destination path and optional rename source path;
- change type;
- meaningful folder and module path;
- additions and deletions;
- normalized changed ranges;
- text patch when supported;
- binary flag; and
- content fingerprint.

### `intelligence_changed_symbols`

Stores:

- changed-file ID;
- symbol kind;
- simple name;
- qualified name;
- declaration start/end lines; and
- changed start/end lines.

### `intelligence_overlaps`

Stores:

- snapshot ID;
- ordered left/right intelligence-worktree IDs;
- final risk level;
- overlap category;
- deterministic reason code and display summary;
- actionable flag; and
- stable ordering metadata.

### `intelligence_overlap_targets`

Stores:

- overlap ID;
- target type (`file`, `module`, `symbol`, or `folder`);
- normalized path;
- optional symbol identity;
- left and right changed-file IDs when applicable; and
- target-specific risk reason.

Foreign keys, uniqueness constraints, and repository/snapshot/worktree lookup indexes prevent duplicate normalized records and keep snapshot reads bounded.

## Typed IPC Contract

Shared Zod schemas define every request, response, and event. The renderer never receives database rows directly.

The preload API adds an `intelligence` namespace with operations equivalent to:

- `listRepositories()` — repositories with eligible or persisted intelligence.
- `getSnapshot({ repositoryId })` — latest successful snapshot and stale/error state.
- `refresh({ repositoryId })` — start or join local analysis and return the resulting snapshot.
- `getOverlap({ overlapId })` — focused overlap details and targets.
- `compareDiffs({ overlapId, targetId? })` — persisted left/right patches for comparison.
- `onSnapshotChanged(listener)` — typed notification when a newer snapshot is committed.

IPC handlers validate renderer input, remain thin, and delegate all analysis and persistence to the Main Process service. Paths supplied by the renderer are never trusted as filesystem locations.

## Renderer Architecture

### Route and Navigation

Add `/intelligence` as a dedicated top-level route and **Intelligence** sidebar item between Coding Agent and Settings. The AppShell treats it as a standard non-dashboard page with the existing header, transitions, sidebar behavior, and theme toggle.

### Page Components

The page is split by responsibility:

- `IntelligencePage` — repository selection, snapshot loading, refresh subscription, and top-level states.
- `IntelligenceSummary` — four compact summary cards.
- `WorktreeOverlapMap` — map pagination, node selection, relationships, and accessible relationship descriptions.
- `IntelligenceWorktreeNode` — one worktree's operational state.
- `AttentionPanel` — actionable overlaps only, ordered by risk and stable tie-breakers.
- `OverlapDetails` — reason, worktrees, files, modules, symbols, and changed ranges.
- `DiffComparison` — synchronized left/right persisted patches and file selection.

Presentation logic stays in the renderer. Git operations, parsing, classification, and persistence remain in the Main Process.

### Actions

- **Review overlap** opens the focused overlap details.
- **Compare diff** opens a two-column comparison for the selected target.
- **Inspect files** filters overlap details to a file or module target.
- **Open chat** navigates to `/coding-agent/:worktreeId/:runId` using persisted identifiers.
- **Refresh** invokes local analysis while preserving the previous snapshot until success.

Risk is represented with text/icons and line patterns in addition to color. Interactive controls remain keyboard accessible and use visible focus states.

## Attention Semantics

The Attention panel is intentionally narrower than the complete overlap map.

An overlap is actionable when:

- it is high risk; or
- it is medium risk and involves the same file, or three or more worktrees in one module.

A medium relationship based only on two related files in one module remains visible on the map but does not enter Attention. Low-risk and independent relationships never enter Attention.

Items are ordered by:

1. risk severity;
2. symbol before file before module;
3. number of involved worktrees;
4. normalized path; and
5. stable overlap ID.

## Error Handling and Recovery

- Missing base branches, invalid worktrees, or inaccessible paths produce worktree-scoped warnings.
- One worktree failure does not suppress valid analysis for other worktrees.
- Git errors preserve command and worktree context in Main Process logs while IPC responses remain user-friendly.
- Parser failures fall back to file/module intelligence.
- Unsupported encodings and binary files skip textual patch/symbol analysis safely.
- A repository refresh that cannot produce a coherent snapshot leaves the last successful snapshot current and marks it stale.
- SQLite replacement is transactional.
- Renderer loading, refreshing, stale, empty, partial-warning, and failed states provide explicit recovery actions.
- Errors are never silently ignored.

## Performance and Safety

- Git commands use argument arrays rather than shell interpolation.
- Analysis is repository-scoped and concurrency-bounded.
- Per-repository refreshes are coalesced.
- Files above a configured text-size limit receive file-level metadata without full content parsing.
- Content fingerprints allow unchanged file analyses to be reused in a later optimization without altering contracts.
- Patch and symbol payloads are fetched on demand for detail views rather than included in the initial map DTO.
- All paths are normalized and validated against known worktree roots.
- Analysis performs no writes to Git worktrees.

## Testing Strategy

### Git collection tests

Use temporary repositories and worktrees to verify:

- merge-base selection;
- committed branch changes;
- staged, unstaged, and untracked changes;
- additions, modifications, deletions, and renames;
- binary and ignored files;
- changed-range parsing; and
- worktree-boundary validation.

### Symbol analysis tests

Verify TS/TSX/JS/JSX extraction and changed-range mapping for:

- top-level functions;
- methods and classes;
- interfaces and type aliases;
- arrow-function variables;
- nested declarations;
- same simple names under different qualified parents;
- malformed files; and
- unsupported extensions.

### Classification tests

Cover every risk rule, rule priority, multiple simultaneous targets, same-symbol detection, overlapping ranges, same-file/different-symbol relationships, module relationships, low-risk folder ancestry, and independent worktrees.

### Persistence tests

Verify normalized inserts, uniqueness, cascade behavior, transactional snapshot replacement, failed-refresh preservation, stable ordering, and reloading after restart.

### IPC tests

Verify Zod input validation, DTO output validation, thin handler delegation, preload namespace typing, event subscription cleanup, and rejection of unknown identifiers.

### Renderer tests

Verify loading, refreshing, stale, empty, partial-warning, and error states; four-node pagination; Attention filtering and ordering; overlap detail selection; diff comparison; and direct chat navigation.

## Completion Verification

Before completion:

1. Generate Drizzle migration artifacts.
2. Run focused intelligence unit and integration tests.
3. Run project TypeScript checking.
4. Run renderer production build because routing, components, and styling change.
5. Run the full Vitest suite.
6. Run project diagnostics and resolve blocking findings.
7. Confirm no environment files, databases, logs, local worktrees, or build artifacts are staged.

## Modified Areas Expected During Implementation

- Shared database schema and generated migration.
- Shared IPC channels, Zod schemas, and API interface.
- Preload bridge.
- Main Process intelligence collector, symbol analyzer, classifier, repository, service, and IPC handlers.
- Coding-agent event integration for debounced refreshes.
- Renderer route, sidebar navigation, Intelligence page, focused components, and tests.
- Existing design tokens and reusable UI components only where required; no unrelated redesign.
