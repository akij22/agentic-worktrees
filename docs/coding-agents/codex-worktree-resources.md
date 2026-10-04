# Codex Worktree Resource integration

Implements [Integrate Codex Worktree Runtime and explicit Resources](https://github.com/akij22/agentic-worktrees/issues/82). The qualified provider is **Codex CLI 0.154.0, adapter contract 1**, with evidence contract `codex/0.154.0/assignment-v1`. Managed activation rejects other versions. Legacy adapters retain their previous behavior until the dedicated application cutover.

## Ownership and admission

`CodexWorktreeRuntimeFactory` implements the existing manager factory. Its main-process loader supplies an immutable Assignment/catalog lineage, canonical Worktree directory, validated Skill package contents and identities, Capability connections and exact tool mappings, centrally prepared environment, evidence writer, attestation callbacks, typed Host observation subscription and captured Host shutdown function. Capability plans require both observation and shutdown ownership. Exact Worktree/generation lookup returns the owned adapter; the owned runtime declares `skillIsolation: not_enforced`.

A generation gets private HOME, read-only assigned Skill packages and an application-generated MCP configuration. Session data uses a separate Worktree-owned CODEX_HOME retained across generations. A private owner marker binds it to the Worktree. Configuration bytes, file/device/inode identity, permissions, symlinks, package digests and assigned native Skill catalog entries are checked before admission. Plans are cloned and frozen; caller mutation cannot change a running Assignment. Failed verification permanently closes that generation. Activation verifies the owned Host catalog before publishing attestation, and session admission verifies the provider's connected managed MCP catalog. Database attestation is checked before subsequent create/resume/turn admission. Unexpected process exit invalidates attestation, retires evidence and triggers captured Host cleanup; cleanup failure is surfaced through the factory exit callback and subsequent shutdown.

Codex reads managed MCP servers at startup. Each owned server receives `default_tools_approval_mode = "approve"` in its private launch configuration. No arbitrary external server receives this policy. Exact provider catalog checks reject additional tools on a managed connection. Assigned explicit Skill ID/name/path and the immutable package digest are validated before native `turn/start`. Legacy global Skill/Capability mutation APIs reject managed runtimes.

## Evidence and disclosure

Only terminal `mcpToolCall` items from live notifications or `thread/read` can supply Capability receipts. In-progress items are request evidence only. The reserved final receipt must pair with trusted Host entry under the immutable provider contract and exact registered application route. Credentials, connection/profile names, ordering and ordinary provider output never establish session use. Replayed history deduplicates, retries create separate invocations, and retained pre-resume turns are excluded from the new generation's attribution while their receipts are redacted for presentation.

Cancellation follows the existing evidence contract's provider-first acknowledgement, followed by cancellation of only exact registered main-process Host dispatches. **If interruption discards the terminal provider receipt, session use remains unconfirmed/Unknown.** Host cancellation acknowledgement or outcome alone never upgrades session attribution. This is the explicit fallback allowed by the integration ticket, rather than a claim that the stronger Host-first receipt-preserving cancellation path is implemented.

Explicit Skill requests produce E1 after native turn admission. E2 requires the actual pinned provider's owned rollout: matching `session_meta` thread/version/cwd, matching native `turn_context` ID, and an exact user context envelope containing the assigned canonical name/path and complete SKILL.md body. Partial bodies, different paths, foreign threads and automatic/ambient contexts cannot qualify. The evidence writer receives only opaque identities and body digests, never the rollout path or body. Public input/history alone is insufficient for E2.

Codex Skill isolation remains **not_enforced**. `skills/extraRoots/set` is additive; ambient/project/native Skills may remain available. Create/resume results and the owned runtime expose the declaration, and the attestation fingerprint includes it. The existing Assignment provider record/schema persists this posture; the Assignment coordinator must continue carrying it into its persisted projection and composer disclosure. Automatic Skill context is deliberately unqualified. Transport receipts, known Host UUIDs, credentials, private Resource paths and native Skill envelopes are sanitized before adapter presentation/events.

## Qualification and handoff

Run `npm run qualify:codex-resources -- /absolute/path/to/codex-0.154.0`. An absent/non-executable binary fails; supplying an unsupported binary fails managed launch. The command runs the complete focused suite with all real-provider checks enabled. Nine real-provider tests cover private launch, local model turns, exact explicit Skill context, Capability success/reported-error/throw/timeout/cancellation (including retry/replay), and restart/resume. These checks launch the actual pinned binary against an inert loopback Responses fixture and real Capability Hosts/evidence services, without an external model service or user credentials. Deterministic launched JSON-RPC tests cover unsupported versions, unassigned Skills, immutable projection, managed approvals/catalog mismatch, missing evidence, conflict/stale/direct-credential cases, history exclusion, manager/database attestation, mutation rejection, process-exit invalidation and privacy-safe RPC/missing-rollout errors.

[Implement Worktree Resource Assignment coordinator](https://github.com/akij22/agentic-worktrees/issues/83) supplies activation plans, persists provider posture and connects factory callbacks to manager lifecycle. [Cut over and qualify Worktree Resources cross-provider release](https://github.com/akij22/agentic-worktrees/issues/86) switches the default application path and runs the full cross-provider/platform release matrix. This implementation is qualified on macOS arm64; it does not close that release gate. No renderer, schema or migration artifacts changed.

## Modified files

| File | Purpose |
| --- | --- |
| `package.json` | Expose the explicit pinned-Codex qualification command. |
| `src/main/coding-agents/codex-adapter.ts` | Add managed launch/admission, exact native Skill dispatch, route/evidence ingestion, sanitized presentation, mutation guards, cancellation and exit invalidation while preserving legacy mode. |
| `src/main/coding-agents/codex-app-server-client.ts` | Accept an explicit private launch environment/arguments and report owned unexpected process exit. |
| `src/main/coding-agents/codex-worktree-runtime.ts` | Define the pinned contract, frozen plan, private persistent namespace, immutable packages/configuration, Host/catalog verification and fixed evidence identity mapping. |
| `src/main/coding-agents/codex-resource-evidence.ts` | Bridge terminal MCP and exact explicit Skill context into the sole evidence writer, exclude retained history, register exact dispatch/cancellation ownership and sanitize private transport. |
| `src/main/coding-agents/codex-worktree-runtime-factory.ts` | Integrate owned generations with manager activation/attestation, persistent Worktree data, verified cleanup and declared Skill posture. |
| `src/main/coding-agents/codex-worktree-runtime.test.ts` | Verify the agreed public boundaries through launched protocol fixtures, real services, and actual pinned CLI qualification. |
| `src/main/coding-agents/fixtures/codex-runtime-provider.mjs` | Launch the deterministic app-server protocol fixture. |
| `src/main/coding-agents/fixtures/codex-runtime-evidence-fixture.ts` | Arrange real SQLite/evidence/attestation services without mocking application internals. |
| `src/main/coding-agents/fixtures/codex-local-responses-fixture.ts` | Supply inert local model events to the real pinned provider without logging model requests. |
| `src/main/coding-agents/fixtures/README.md` | Record Codex fixture provenance and capture/privacy boundaries. |
| `scripts/codex-runtime/qualify.mjs` | Require an explicit executable and propagate qualification failure. |
| `docs/coding-agents/codex-worktree-resources.md` | Record behavior, qualification, file-level changes, cancellation limits and coordinator/release handoff. |

## Validation

- `npm run typecheck`: passed.
- Focused ESLint on all changed TypeScript files: passed with no findings.
- `npm test -- --maxWorkers=1`: 1,408 passed, 13 optional real-provider checks skipped, one pre-existing failure in `capability-block-policy.test.ts:80` (`installed` instead of `blocked`). This is the same baseline failure recorded by the preceding integration ticket.
- `npm run lint`: the same eight pre-existing errors and 40 warnings recorded by the preceding ticket; none in changed files.
- `npm run qualify:codex-resources -- <0.154.0 binary>`: all 29 tests passed, including all nine real-provider tests.
- Qualification without a binary: failed with nonzero exit status as required.
- `npm run package`: passed for macOS arm64, including production bundles and native dependency preparation.
- `git diff --check` and repository artifact/privacy review: passed; no provider captures, credentials, rollout files or build artifacts are included.
