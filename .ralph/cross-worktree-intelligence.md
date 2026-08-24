# Cross-Worktree Intelligence

Implement `docs/superpowers/plans/2026-08-09-cross-worktree-intelligence.md` inline with TDD and no subagents.

## Goals

- Deterministic Main Process Git/AST overlap analysis.
- Normalized SQLite persistence and typed IPC only.
- Mission Control renderer matching the supplied concept.
- Actionable Attention, overlap details, diff comparison, and direct chat navigation.

## Checklist

- [x] Tasks 1–6: analysis foundation, persistence, contracts
- [x] Task 7: orchestration service
- [x] Task 8: IPC/event integration
- [x] Task 9: route/hook/page states
- [x] Task 10: Mission Control UI/interactions — delivered in `5d62d08`; the graph presentation was intentionally superseded by the conflict-focused workspace in `67c1ce0` while preserving Attention, evidence inspection, persisted diff comparison, and direct chat navigation.
- [x] Task 11: docs/full verification/report — delivered in `a92cc11` and re-verified against the current conflict-confirmation implementation.

## Verification

- Baseline: 50 files and 370 tests passed after rebuilding `better-sqlite3` for Node ABI 137.
- Tasks 1–6: focused tests and typecheck passed; generated migration `0004_safe_energizer.sql`.
- Task 7: `npx vitest run src/main/intelligence/intelligence-service.test.ts` — 4 tests passed; `npm run typecheck` passed; commit `7d4b4b8`.
- Task 8: `npx vitest run src/main/ipc/github-auth-handlers.test.ts src/preload-auth.test.ts` — 28 tests passed; `npm run typecheck` passed; primary LSP errors: 0; commit `8584b10`.
- Task 9: hook/layout focused suite — 5 tests passed; `npm run typecheck` passed; primary LSP errors: 0; commit `909e6c5`.
- Task 10: renderer interaction coverage, typecheck, lint, and Electron packaging passed; commit `5d62d08`.
- Task 11: README usage and scope documentation delivered in `a92cc11`.
- Current audit (2026-08-24): focused intelligence suite — 34 files and 243 tests passed; `npm run typecheck` passed; `npm run lint` exited 0 with 3 pre-existing warnings outside Intelligence; full suite — 154 files and 1023 tests passed; `npm run package` packaged successfully for Darwin arm64. `lens_diagnostics` was not exposed by the current harness.

## Reflection — Iteration 4

- Accomplished: deterministic collector, AST symbols, classifier, normalized persistence, orchestration, IPC, preload, and the dedicated route are committed.
- Working well: small dependency-injected units and RED/GREEN focused tests are keeping Main Process boundaries explicit.
- Friction: project-wide extensionless-import and legacy AppShell diagnostics create noise but no primary TypeScript errors; dispositions are recorded where applicable.
- Adjustment: keep Task 10 split into focused components rather than expanding `Intelligence.tsx`; preserve the approved dense industrial visual language and existing tokens.
- Next priorities: complete map/Attention/details/comparison interactions, then run full verification and package rebuild handling.

## Reflection — Iteration 5

- Accomplished: reconciled the stale checklist with repository history. The original map-based Task 10 and documentation Task 11 were completed, then the renderer intentionally evolved into the approved conflict-focused workspace with Git-confirmation preparation.
- Preserved behavior: actionable Attention filtering, normalized evidence, persisted two-sided diff comparison, direct worktree chat navigation, stale snapshot recovery, and local deterministic analysis remain covered by the current implementation.
- Verification: rebuilt `better-sqlite3` for Node ABI 137, then completed the focused suite, typecheck, lint, full test suite, and Electron packaging gate successfully.
- Remaining work: none for this plan. Later conflict-resolution phases remain explicitly outside this plan's scope.

## Completion Gate

Run `npm run typecheck && npm run lint && npm test && npm run package`, then `lens_diagnostics mode=all`; record exact results before completion.
