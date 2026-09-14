# Throwaway #73 — Session-aware Capability receipt and cancellation bridge

## Verdict

**The proposed bridge is sufficient on the host/application side and is qualified for OpenCode 1.18.30, but Codex 0.154.0 still does not preserve a terminal provider receipt. Cross-provider per-session Capability attribution remains unavailable.**

The bridge generates an opaque invocation UUID outside Capability implementation code, emits typed entered/outcome evidence, wraps the same receipt into success and every post-entry error result, correlates only exact provider-retained receipts in the active runtime generation, and cancels only an exact active invocation through a trusted side channel.

OpenCode retained receipts for concurrent success, profile switch, reported error, throw, timeout, retry, and history after runtime restart. Provider abort acknowledgement alone did not cancel the host; the adapter-side invocation cancellation did, yielding a typed `cancelled` outcome. Duplicate replay was idempotent, stale runtime evidence was rejected, conflicting sessions were quarantined, and a direct authenticated host call remained Used with session Unknown.

Codex received successful production-host results containing the receipt in both SSE and JSON response modes, but its `mcpToolCall` did not become terminal and retained no receipt. The custom bridge run also observed a provider item start without a qualified retained result. Therefore Codex cannot pass the current version gate even though host execution can be proven.

## Artifacts

All artifacts are throwaway and isolated on branch `prototype/capability-receipt-bridge`.

- `bridge.ts` — inert JSON MCP host, typed evidence, fail-closed correlator, and exact cancellation registry.
- `bridge.test.ts` — deterministic outcome/cancellation/correlation tests.
- `probe.ts` / `run.mjs` — live OpenCode/Codex probe in private temporary namespaces.
- `observed.json` — reviewed sanitized live run.
- `codex-transport-observed.json` — reviewed sanitized diagnosis against the repository production host in SSE and JSON modes.
- `index.html` — interactive evidence model.

Run:

```sh
node src/main/capabilities/prototype-capability-receipt-bridge/run.mjs --existing-auth
npm test -- src/main/capabilities/prototype-capability-receipt-bridge/bridge.test.ts
open src/main/capabilities/prototype-capability-receipt-bridge/index.html
```

The auth option links only the known Codex CLI auth file into a temporary private namespace. No credential is read or printed. Outputs exclude prompts, model output, Resource bodies, credentials, private paths, and provider session IDs.

## Tested versions

- Codex CLI 0.154.0.
- OpenCode CLI 1.18.30.
- Node 24.3.0.
- Repository dependency lockfile.

## Bridge protocol

### Host evidence

After tool lookup and input validation, but before Capability code executes:

```text
host.invocation.entered {
  invocationId,
  runtimeGeneration,
  lease,
  resourceId,
  mode
}
```

On every post-entry path:

```text
host.invocation.outcome {
  invocationId,
  runtimeGeneration,
  outcome: success | reported_error | thrown | timeout | cancelled
}
```

The MCP result carries the same opaque receipt and outcome for every path. Capability exceptions are caught outside Capability code; they cannot replace the receipt with a generic error. Inputs, outputs, settings, credentials, and exception text are not included in typed evidence.

### Provider evidence

The adapter snapshots the provider's structured item/ToolPart before renderer projection:

```text
provider.receipt {
  provider,
  applicationSession,
  expectedLease,
  runtimeGeneration,
  invocationId,
  transformedServerToolIdentity,
  providerEventIdentity
}
```

`applicationSession` is obtained from the adapter's registered external-session routing, not from the MCP credential. Provider session IDs are not persisted in diagnostics.

### Correlation

A per-session pair exists only when:

1. one trusted host entered event exists for the invocation;
2. one terminal host outcome exists or the invocation is still explicitly entered;
3. exactly one application session has a trusted provider event with the same receipt;
4. both events carry the active runtime generation;
5. provider event identity replay is deduplicated;
6. server/profile/expected-lease mismatch is recorded and quarantines runtime admission.

No match by time, order, arguments, display name, Worktree, credential, provider call ID, or MCP JSON-RPC ID is permitted.

Host entry without a provider receipt is Resource Used with session Unknown. Provider item without host entry is an attempted request, not Used. Conflicting sessions invalidate attribution rather than choosing one.

## OpenCode observations

The reviewed run proved:

- two concurrent sessions retained two distinct success receipts;
- session B using profile A retained the A host receipt inside B's ToolPart, pairing origin to B and exposing one lease mismatch;
- post-entry `isError`, thrown exception, and timeout each retained one receipt in a ToolPart;
- retry in the same provider session produced a new invocation UUID rather than reusing the earlier receipt;
- restart/history retained prior receipts;
- a wait invocation entered, OpenCode accepted session abort, and the trusted side channel cancelled that exact invocation with outcome `cancelled`;
- cancellation had no provider receipt and therefore does not independently establish a session activity pair.

The side channel proves exact handler cancellation mechanics. Production wiring must derive the active invocation from trusted adapter/host registration and runtime generation. It must not let the renderer submit invocation IDs.

## Codex transport diagnosis

The repository host was instrumented through a local metadata-only reverse proxy. In the SSE run:

- Codex sent `initialize`, `tools/list`, and `tools/call`;
- the validated host handler entered and completed successfully;
- HTTP 200 `text/event-stream` ended and contained the receipt;
- the provider item did not reach a terminal state and retained no receipt.

The same experiment set the MCP SDK's standard `enableJsonResponse: true` option:

- HTTP 200 `application/json` ended and contained the receipt;
- the provider item again remained nonterminal without a retained receipt.

Thus the #71 failure was not missing auth, invalid input, model refusal, or absent host execution. JSON framing alone does not repair Codex 0.154.0. This may be a provider MCP completion bug or an unqualified contract interaction; either way, the observable application contract fails.

Do not infer Codex session attribution from its item start, the presented server lease, or the host success.

## Cancellation boundary

Provider `abort` and host invocation cancellation are separate facts.

Production requires an internal active-invocation registry keyed by `(runtimeGeneration, invocationId)`. The adapter-side cancellation path:

1. stops/interrupts the provider session through its native API;
2. resolves only invocation IDs already registered to that adapter/session dispatch boundary;
3. sends typed cancellation to the owned Capability Host;
4. receives `cancel_requested` or a terminal not-active result;
5. waits for `host.invocation.outcome(cancelled|...)`;
6. records provider cancellation and host outcome separately.

A stale runtime generation is rejected. More than one possible invocation or profile mismatch closes admission and requires recovery; the system does not cancel by Worktree, tool name, or time window. Process-tree shutdown is a recovery fallback, not proof of invocation cancellation.

The renderer can request “Stop agent” but never receives or supplies invocation IDs.

## Production changes required

1. Move invocation UUID generation and exception/timeout wrapping into the repository Capability Host boundary.
2. Extend the main↔host protocol with sanitized entered/outcome/cancel request/cancel acknowledgement messages.
3. Add an internal active invocation registry scoped by runtime generation.
4. Ensure MCP success and every post-entry error response preserve a provider-visible opaque receipt.
5. Snapshot raw provider terminal evidence before display normalization.
6. Correlate exact receipts with duplicate/conflict/stale-generation rejection.
7. Quarantine lease/profile mismatches and ambiguous cancellation.
8. Keep unpaired host evidence Used with session Unknown.
9. Add version-pinned executable fixtures for every supported provider release.

No database/UI implementation should depend on the prototype marker string. Production should use a provider-preserved structured metadata field where available; if text is the only qualified channel, use a reserved authenticated envelope that is removed from model-visible/UI output and tested against spoofing. A model- or Capability-supplied receipt is never trusted.

## Spoofing and trust

- Invocation IDs come only from the owned host after validation.
- Provider text containing a receipt-like marker without matching trusted host evidence is ignored.
- Capability output cannot select or overwrite the host receipt envelope.
- Duplicate provider events with the same event identity are replay.
- The same invocation claimed by different sessions is conflict, session Unknown, and runtime quarantine.
- Stale runtime generation events cannot pair.
- Direct credential reuse proves host execution only.

## Consequence for #65

#65 can now define the evidence envelope and Unknown-session fallback precisely. It must not claim cross-provider per-session Capability activity is currently qualified:

- OpenCode 1.18.30 may use exact terminal receipt pairing after the production bridge passes equivalent fixtures.
- Codex 0.154.0 remains `provider_unqualified` for per-session Capability attribution.
- Host entered/outcome evidence still records honest Resource Used/outcome at non-session scope.
- Session timelines show Capability Used only for exact qualified pairs.

## HITL recommendation

Adopt the bridge contract and allow #65 specification work to proceed, while retaining a release/implementation gate for Codex terminal receipt preservation. Do not block definition of Unknown behavior, and do not weaken per-session attribution to lease inference.
