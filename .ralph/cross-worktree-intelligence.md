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
- [ ] Task 10: Mission Control UI/interactions
- [ ] Task 11: docs/full verification/report

## Verification

- Baseline: 50 files and 370 tests passed after rebuilding `better-sqlite3` for Node ABI 137.
- Tasks 1–6: focused tests and typecheck passed; generated migration `0004_safe_energizer.sql`.
- Task 7: `npx vitest run src/main/intelligence/intelligence-service.test.ts` — 4 tests passed; `npm run typecheck` passed; commit `7d4b4b8`.
- Task 8: `npx vitest run src/main/ipc/github-auth-handlers.test.ts src/preload-auth.test.ts` — 28 tests passed; `npm run typecheck` passed; primary LSP errors: 0; commit `8584b10`.
- Task 9: hook/layout focused suite — 5 tests passed; `npm run typecheck` passed; primary LSP errors: 0; commit `909e6c5`.

## Reflection — Iteration 4

- Accomplished: deterministic collector, AST symbols, classifier, normalized persistence, orchestration, IPC, preload, and the dedicated route are committed.
- Working well: small dependency-injected units and RED/GREEN focused tests are keeping Main Process boundaries explicit.
- Friction: project-wide extensionless-import and legacy AppShell diagnostics create noise but no primary TypeScript errors; dispositions are recorded where applicable.
- Adjustment: keep Task 10 split into focused components rather than expanding `Intelligence.tsx`; preserve the approved dense industrial visual language and existing tokens.
- Next priorities: complete map/Attention/details/comparison interactions, then run full verification and package rebuild handling.

## Completion Gate

Run `npm run typecheck && npm run lint && npm test && npm run package`, then `lens_diagnostics mode=all`; record exact results before completion.
