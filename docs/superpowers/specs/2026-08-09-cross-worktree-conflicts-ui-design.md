# Cross-Worktree Conflicts UI Design

## Objective

Replace the graph-oriented Intelligence workspace with a conflict-focused Mission Control that closely follows the supplied reference image. The screen must use persisted repository intelligence data and existing typed IPC APIs. It must not introduce mock data or alter any other route.

## Scope

Only `/intelligence` and renderer components under `src/renderer/features/intelligence` change. Existing repository selection, refresh orchestration, stale-snapshot preservation, chat routes, and persisted diff comparison remain intact. AppShell, dashboard, coding-agent, settings, Main Process analysis, database schema, and IPC contracts remain unchanged.

## Information Architecture

### Header

The page title becomes **Cross-worktree conflicts** with the subtitle “See the most important overlaps across active worktrees.” The existing repository selector and refresh control remain in the upper-right. Refresh, stale, warning, and error feedback continues to use real hook state.

### Summary

Four compact cards show values derived from the selected snapshot:

1. Active worktrees: `snapshot.worktrees.length`.
2. High-risk conflicts: high-risk overlaps.
3. Medium overlaps: medium-risk overlaps.
4. Independent worktrees: worktrees marked `independent`.

No completion percentage, inferred progress, or generated statistic is displayed.

### Three-Column Workspace

The main workspace reproduces the reference structure:

- **Conflict list:** all high- and medium-risk overlaps, with high first and stable snapshot order within each severity. Each card shows risk, both task names, deterministic summary/path, agent identities, update recency, and involved file count. Selecting a card updates the other columns.
- **Conflict details:** selected worktree pair, risk, reason, affected files, per-side modified state, overlap classification, and shared symbols/functions. Details are derived from `overlap.targets` and the corresponding snapshot worktrees; no additional guesses are introduced.
- **Actions and quick context:** both involved worktree cards, direct Open Chat buttons when run IDs exist, Compare Diffs, and an independent-worktrees section.

The existing persisted diff comparison dialog remains the comparison surface. Overlap evidence moves inline, so the graph and separate overlap-details dialog are removed from this page.

## Selection and Data Flow

The page receives a persisted snapshot from `useIntelligence`. It derives conflict candidates locally without mutating backend classifications. Selection defaults to the first high/medium conflict and remains stable by overlap ID across snapshot updates when possible. If the selected overlap disappears, selection moves to the first available candidate.

All worktree labels, branches, agents, file counts, additions, deletions, paths, symbols, risks, reasons, and chat identifiers come from the snapshot DTO. Diff comparison continues to load on demand through `window.api.intelligence.compareDiffs`.

## Responsive Behavior

At wide desktop widths, the screen uses the reference three-column layout: conflict list, dominant details panel, and action context. At narrower application widths, columns stack in information order and retain independent scrolling where needed. Content remains readable at the application minimum size; it is not compressed into graph-like or unreadable cards.

## Visual Direction

Use the application's existing dark/light tokens and Geist typography while matching the reference's dense operational character:

- low-radius bordered panels;
- strong red and amber severity accents;
- compact monospace metadata;
- restrained shadows and translucent card surfaces;
- explicit textual risk labels so meaning never depends on color;
- no decorative gradients, graph connectors, or fabricated visual activity.

## States and Error Handling

Retain accessible states for loading, no repositories, no changed worktrees, stale snapshots, warnings, and refresh failures. Add a conflict-free state when worktrees exist but no high/medium overlaps are present. The latest successful snapshot remains visible after refresh errors.

## Testing

Renderer tests will verify:

- low-risk overlaps are excluded;
- high-risk conflicts sort before medium overlaps;
- selecting a conflict updates inline details;
- file and symbol evidence comes from snapshot targets/files;
- involved and independent worktree metrics use snapshot values;
- chat callbacks receive real worktree/run IDs;
- Compare Diffs opens for the selected overlap;
- conflict-free and stale/error states remain accessible.

Focused renderer tests, TypeScript diagnostics, lint on changed files, and Electron packaging will validate the change.
