# Throwaway #71 — Provider session pairing for Capability dispatch

## Verdict

**A host-generated opaque invocation receipt echoed through the MCP result can pair successful OpenCode calls to the exact provider session, even when that session uses another session's profile. The current cross-provider boundary is still incomplete and must remain fail-closed.**

Codex 0.154.0 verified five session-scoped MCP server catalogs and persisted five target `mcpToolCall` items, but every call failed before entering the inert Capability handler. No host receipt reached Codex history, so Codex pairing is unqualified. OpenCode 1.18.30 preserved two distinct successful receipts across concurrent sessions and paired a profile-A invocation to the real originating session B. Generic post-entry errors and cancellation did not preserve a provider receipt.

A direct call with a valid run credential entered the host but generated no provider event; its session attribution correctly remains Unknown. Credentials, server names, timing, arguments and worktree ownership are not session proof.

## Artifacts and usage

All files are throwaway evidence on branch `prototype/provider-session-pairing`; production code and protocols are unchanged.

- `probe.ts` — actual repository Capability Host plus live Codex/OpenCode sessions and inert tools.
- `run.mjs` — temporary esbuild launcher using existing dependencies.
- `observed.json` — sanitized reviewed run.
- `index.html` — double-clickable evidence model with seven guided scenarios.

From repository root:

```sh
node src/main/capabilities/prototype-provider-session-pairing/run.mjs --existing-auth
open src/main/capabilities/prototype-provider-session-pairing/index.html
```

The auth flag creates a temporary symlink only for Codex's known CLI auth file. OpenCode uses its public provider. The launcher never reads or prints credentials. Output contains counts, versions and outcome categories only—no prompts, model output, paths, tokens or session identifiers.

## Reproducibility

Reviewed base: `a6ff2de`.

Observed with:

- Node 24.3.0.
- Codex CLI 0.154.0.
- OpenCode CLI 1.18.30.
- Repository Capability Host and MCP SDK from the lockfile.

Two real host listeners represent session leases A/B inside one logical Worktree Runtime. Each has a unique server name and unguessable credential but exposes the same inert `receipt_probe` tool. The handler creates a UUID only after validation and returns `AW_RECEIPT:<uuid>` for normal results. The marker is synthetic and visible to the model in this prototype; production should prefer a provider-preserved structured metadata field if qualified.

## Observed matrix

| Case | Host evidence | Provider evidence | Session result |
|---|---|---|---|
| OpenCode concurrent A/B success | Two exact handler entries with distinct UUIDs | Two ToolParts retain matching UUIDs and external session ownership | Exact A and B pairing |
| OpenCode session B using profile A | A-lease handler result is returned through B's ToolPart | ToolPart belongs to B and names A's transformed server/tool | Exact B origin plus lease/profile mismatch |
| Direct A credential reuse | Exact A-lease handler entry | No provider event/receipt | Unknown session |
| OpenCode `isError` attempt | Handler entry observed, but the request/history path did not yield a retained receipt in the reviewed run | No qualified receipt | Used Resource, Unknown session |
| OpenCode thrown error | Handler entered and threw | Current host emits generic error without UUID | Used Resource, Unknown session |
| OpenCode session abort during wait | Handler entered; abort endpoint accepted | No receipt; handler remained entered at the 500 ms check and was aborted only when the owned provider process stopped | Cancellation not routed/proven |
| Codex target calls | Session catalogs verified; provider emitted target `mcpToolCall` items | Items were failed before host entry | E1 failed attempts; no Used or pairing proof |

The host ledger after the reviewed run contained seven entries: four successes, one reported error, one thrown error and one eventual abort. Only provider-retained matching receipts qualify for session attribution.

## Why the receipt changes the #63 counterexample

A session-scoped credential proves only which lease reached the host. If B selects A's profile, lease attribution alone incorrectly says A. With an echoed host UUID, B's structured provider ToolPart contains the exact invocation receipt, so the backend can record:

- Resource execution: proven by trusted host entry;
- originating provider session: B;
- presented lease/profile: A;
- policy result: mismatch requiring quarantine/recovery.

A direct shell/curl call can present A's credential, but it has no trusted provider ToolPart carrying the receipt. It remains exact Capability execution with Unknown session and is not rendered in any session timeline.

No joins use timing, order, arguments, display titles or presumed equality between provider call IDs and MCP JSON-RPC IDs.

## Required production boundary

1. The owned Capability Host creates `invocationId` immediately after tool lookup and argument validation, before implementation execution.
2. The host emits typed `host.invocation.entered` and `host.invocation.outcome` messages containing runtime/catalog generation, opaque lease reference, exact Resource ID/version/digest and invocation ID. It never sends arguments/results/secrets.
3. Every MCP success and error response must carry the same opaque invocation receipt through a provider-preserved field. The provider adapter snapshots the raw ToolPart/item before display projection.
4. A session pair exists only when exactly one trusted provider event from the active runtime generation retains the receipt. Duplicate/conflicting receipts invalidate attribution.
5. Lease/profile mismatch is evidence of the actual provider session but also an isolation violation; close admission and recover the runtime.
6. Host entries without a provider receipt remain Used with Unknown session. They never appear in a per-session activity feed.
7. Retries receive new invocation IDs. Live/history replay deduplicates the same receipt.

## Error and cancellation gaps

The current host creates the invocation ID inside the Capability fixture, so thrown exceptions and host timeouts replace the tool output with a generic error and lose the receipt. Production must generate and wrap the receipt outside Capability code on every post-entry outcome.

OpenCode accepted `session.abort`, but the waiting handler was still `entered` after 500 ms. It became aborted only during provider-process teardown. Therefore provider abort acknowledgement is not proof that the active MCP handler was cancelled.

The current stateless host creates a separate MCP server/transport for every HTTP request. A cancellation notification on another request has no demonstrated shared request registry. A stronger boundary must route adapter cancellation to known active host invocation IDs through trusted main↔host control, while retaining provider/session/generation ownership. Until then cancellation outcome is Unknown and timeout remains the host fallback.

## Codex gate

The probe confirmed thread-scoped server/tool enumeration, but target calls failed before host entry despite a permissive inert schema. This could be transport/config compatibility rather than a general Codex limitation; either way, the pinned combination is not qualified.

Before enabling Codex session attribution, a focused integration must:

- make an inert Capability execute through the exact production Codex connection config;
- preserve the host receipt in live `mcpToolCall` and `thread/read` history;
- cover success, host-reported error, throw, timeout and interrupt;
- confirm thread/profile switch behavior and reconnect/resume;
- prove that failures before host entry remain E1 only.

Do not infer pairing from the observed target item, server name or single active call.

## HITL recommendation

Adopt the **session-aware receipt bridge** as the required design, but keep implementation blocked until:

- Codex can execute and preserve receipts end to end;
- host-generated receipts survive every post-entry result class on both providers;
- cancellation is routed to the exact active invocation rather than inferred from provider acknowledgement.

OpenCode success proves the design direction, not cross-provider completion. The evidence contract can specify Unknown-session fallback, but the requested per-session UI must display Used only for qualified receipt pairs.
