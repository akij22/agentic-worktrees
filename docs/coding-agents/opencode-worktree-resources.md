# OpenCode Worktree Resource integration

This implements [Integrate OpenCode Worktree Runtime and isolated Resources](https://github.com/akij22/agentic-worktrees/issues/81). The qualified contract is **OpenCode CLI 1.18.30, SDK 1.18.30, adapter contract 1**, with evidence contract `opencode/1.18.30/assignment-v1`. Other CLI versions are rejected before managed activation.

## Backend ownership and activation

`OpenCodeWorktreeRuntimeFactory` implements the existing `WorktreeRuntimeFactory` boundary. Its main-process plan loader supplies the exact immutable Assignment/catalog lineage, canonical Worktree directory, validated Skill package files and digests, Capability connections and forward tool identity mappings, centrally prepared environment, evidence writer, activation/attestation/invalidation callbacks, and captured owned Host shutdown function. Capability plans must also supply typed Host observations. The factory owns one adapter/provider process per runtime generation; `getAdapter` requires the exact Worktree and generation.

Each process gets private HOME, XDG config/cache/state and an atomically installed, read-only Skill projection. Session data has a separate private Worktree-owned root so a replacement process can resume an existing session. A read-only owner marker binds this root to the Worktree. Directory/marker identities, symlinks, permissions and ownership are checked again before admission. No provider credentials or unrelated environment settings are inherited automatically.

Global/project/Claude/external Skill discovery is disabled. The effective provider Skill/command catalogs, immutable package files, baseline fingerprints, native tools, MCP connection status, exact Host tool catalogs, generated permissions and configuration must match the activation plan. Baseline, command, transformed-name, plugin, ambient and permission collisions fail closed. Explicit-only package metadata cannot be elevated to automatic invocation. Provider/attestation/files are rechecked before create, resume and turn; a failed proof permanently invalidates that process generation. Configuration repair cannot silently reactivate it.

Cancellation combines the native session abort acknowledgement with exact captured Capability dispatch ownership and typed Host terminal observations. Shutdown attempts cancellation, owned Host shutdown and confirmed captured provider exit, then retires evidence. No process-name searches or broad process kills are used.

The Assignment coordinator and default application cutover belong to [Implement Worktree Resource Assignment coordinator](https://github.com/akij22/agentic-worktrees/issues/83) and [Cut over and qualify Worktree Resources cross-provider release](https://github.com/akij22/agentic-worktrees/issues/86). This ticket supplies their owned factory; it does not replace the legacy shared adapter path globally.

## Qualified evidence and privacy

Provider-native tool names are matched against immutable forward mappings, never reverse-parsed into Resource identities. Trusted Host observations alone do not imply session use. Terminal provider ToolParts must carry the reserved Host receipt and pair with exact Host evidence. Success, reported errors, throws and timeouts qualify; missing receipts remain Unknown. Cancellation acknowledgements do not manufacture Used or a provider receipt.

Explicit Skill requests receive application-generated message identities. The exact injected full command template in the corresponding user message proves explicit context entry. Automatic context requires trusted assistant message metadata and the complete pinned native Skill result, exact assigned name/location/body and allowed reference-file listing. Names, arguments, partial bodies, timing, catalog membership and user-attached ToolParts cannot prove use. Pre-resume history is seeded as historical so a new generation cannot rewrite previous activity with its current lineage.

Bodies, raw events, session IDs and receipts stay in transient provider parsing. Only typed qualified observations enter `ResourceActivityEvidenceService`. Its public snapshots remain sanitized. Transcript/event presentation strips receipt envelopes and known invocation identifiers and omits injected Skill bodies/private locations. Temporary parser buffers are bounded and unsupported schema/routing fails closed. Package identity digests and context body fingerprints are separate: multi-file package membership is not confused with the loaded Skill body.

The isolation claim concerns managed/provider-native Skill discovery and invocation. It is not an OS sandbox or a claim that general filesystem tools cannot read arbitrary files. A malicious actor with the same OS account can change permissions; detected modifications invalidate admission. Cross-platform release qualification remains a separate gate.

## Reproducing qualification

Install the exact binary outside the repository, then pass its absolute executable path:

```sh
npm run qualify:opencode-resources -- /absolute/path/to/opencode-1.18.30
```

The command requires a binary and fails if it is missing, unsupported, or qualification fails. It runs four actual CLI processes/SDK scenarios, including real model execution using the public `opencode/big-pickle` model and inert local Capability tools. Network/model availability is required for the execution scenarios; no user credentials or production data are needed. Regular `npm test` skips these network-dependent cases and runs the launched deterministic protocol fixtures.

The qualification matrix exercises:

| Boundary | Evidence |
| --- | --- |
| Two Worktrees | Disjoint assigned Skill catalogs; project Skill/config contamination excluded; foreign explicit Skill denied |
| Restart/resume | Existing session resumes after restart and across a new private process namespace using owned persistent data |
| Skill context | Explicit command template and actual model-selected native Skill context produce separate qualified modes |
| Capability context | Actual production MCP Host receipts pair for success, reported error, thrown error and timeout |
| Deterministic failure/ownership | Unsupported version, catalog/config/builtin/tool/permission drift, foreign route/profile, file replacement, owner-marker replacement, explicit-only escalation, stale callbacks, receipt echo redaction and exact cancellation |

Local qualification is on macOS arm64. Release must rerun the matrix on every supported platform and model/parser contract before exposing the enforced posture through the application cutover. Pinned public upstream template fixtures and their MIT license are documented in `src/main/coding-agents/fixtures/README.md`.

## Changed files

| File | Purpose |
| --- | --- |
| `package.json` | Pin the provider SDK and expose the explicit real-provider qualification command. |
| `package-lock.json` | Lock the exact SDK package and integrity without unrelated dependency changes. |
| `src/main/coding-agents/opencode-worktree-runtime.ts` | Build private namespaces/immutable projections, verify the effective provider catalog/configuration, and define the exact evidence contract. |
| `src/main/coding-agents/opencode-worktree-runtime-factory.ts` | Provide manager-owned adapters, persistent Worktree session data, captured Host/provider cleanup and evidence retirement. |
| `src/main/coding-agents/opencode-resource-evidence.ts` | Parse qualified session/Skill/Capability evidence, quarantine unsupported routes, prevent historical reassignment, cancel exact owned invocations and redact transport identifiers. |
| `src/main/coding-agents/opencode-adapter.ts` | Integrate managed activation, attestation before operations, public SDK session routing, cancellation, confirmed process exit and safe transcript/event presentation. |
| `src/main/coding-agents/types.ts` | Add the backend application run route to create/resume options. |
| `src/main/resource-activity/resource-activity-evidence-service.ts` | Distinguish the complete Skill context body fingerprint from the immutable package digest. |
| `src/main/resource-activity/resource-activity-evidence-service.test.ts` | Verify distinct package/body digests through sanitized public snapshots. |
| `src/main/coding-agents/opencode-worktree-runtime.test.ts` | Exercise approved public boundaries through actual launched deterministic providers, real SDK/MCP Hosts, manager/database attestation and optional pinned CLI qualification. |
| `src/main/coding-agents/fixtures/opencode-runtime-provider.mjs` | Supply the launched deterministic HTTP/event-stream protocol fixture. |
| `src/main/coding-agents/fixtures/opencode-1.18.30-customize.txt` | Supply the public pinned baseline Skill body for catalog parity. |
| `src/main/coding-agents/fixtures/opencode-1.18.30-initialize.txt` | Supply the public pinned initialization command template. |
| `src/main/coding-agents/fixtures/opencode-1.18.30-review.txt` | Supply the public pinned review command template. |
| `src/main/coding-agents/fixtures/OPENCODE-LICENSE.txt` | Preserve the upstream MIT license for copied public templates. |
| `src/main/coding-agents/fixtures/README.md` | Record fixture provenance and separate public provider templates from user/session data. |
| `scripts/opencode-runtime/qualify.mjs` | Require an explicit executable binary and propagate qualification failure rather than succeeding with skipped real-provider tests. |
| `docs/coding-agents/opencode-worktree-resources.md` | Record the integration handoff, qualification matrix, file-level changes and remaining release boundaries. |

## Validation recorded for this implementation

- `npm run typecheck`: passed.
- Focused ESLint on every changed TypeScript file: passed with no findings.
- `npm test -- --maxWorkers=1`: 1,388 passed, four network qualification cases skipped, one pre-existing failure in `capability-block-policy.test.ts:80` (`installed` instead of `blocked`). The same failure reproduces on parent commit `06c0f95`.
- `npm run lint`: eight pre-existing errors and 40 warnings, identical to the parent commit. None are in the changed files.
- `npm run qualify:opencode-resources -- <pinned binary>`: all four real-provider scenarios passed. Public model/network availability caused unsuccessful earlier attempts; the command fails honestly when qualification cannot complete.
- Calling the qualification command without a binary: rejected with nonzero exit status.
- `npm run package`: passed for macOS arm64, including production main/preload/renderer bundles and native dependency preparation.
- `git diff --check`: passed. The staged scope contains source, public provider fixtures/license, documentation and dependency manifests; no credentials, raw session captures, databases or build artifacts.

No database schema or renderer behavior was changed. Remaining integration/platform release gates are owned by the coordinator and cross-provider cutover tickets linked above.
