# Codex terminal Capability receipt qualification

Issue: #75

Pinned provider: `codex-cli 0.154.0`

Result: **qualified with required MCP approval configuration**

## Decision

Codex 0.154.0 can support per-session Capability Used attribution when all of the following are true:

1. the app-generated MCP server config sets `default_tools_approval_mode = "approve"`;
2. the Capability host emits its receipt only after validated handler entry;
3. the app accepts only a terminal `mcpToolCall` item containing the exact receipt;
4. the receipt is paired to the registered app-session route and active runtime generation;
5. cancellation uses the exact active host invocation ID and waits for the host's terminal receipt.

Without an exact terminal provider receipt, the fallback remains **Capability Used · session Unknown**. No lease, profile, credential, timing, argument, ordering, server name, or current catalog inference is permitted.

## Finding that changed the result

The earlier #73 Codex probe omitted the MCP server's tool approval mode. `approvalPolicy: "never"` is not an MCP auto-approval setting. In the diagnostic app-server path, omitted MCP approval configuration either left approval unresolved or produced an approval-class failure before `tools/call`.

The qualifying config is:

```json
{
  "approvalPolicy": "never",
  "config": {
    "mcp_servers": {
      "<private-server-name>": {
        "url": "<private-loopback-url>",
        "http_headers": { "Authorization": "<private-bearer-header>" },
        "default_tools_approval_mode": "approve"
      }
    }
  }
}
```

This setting delegates user consent and authorization to the application and Capability host. It must be applied only to app-managed Capability servers; it is not permission to auto-approve arbitrary MCP servers.

## Transport result

`transport-observed.json` records four successful variants:

| Host topology | Response framing | Handler entered | Terminal item | Live receipt | Receipt after restart |
|---|---|---:|---:|---:|---:|
| Stateless | SSE | yes | yes | yes | yes |
| Stateless | JSON | yes | yes | yes | yes |
| Stateful | SSE | yes | yes | yes | yes |
| Stateful | JSON | yes | yes | yes | yes |

Stateful transport is therefore not required to fix #73. The existing stateless SSE topology can terminalize correctly when the server approval mode is explicit. The transport probe stops sampling when the terminal item arrives, so its `turnTerminal: false` field does not mean the item was nonterminal; the matrix probe separately waits for turns where sequencing requires it.

## Qualification matrix

`observed.json` is the sanitized machine-readable result.

- Concurrent sessions A and B retained two distinct receipts.
- Retry in session A produced a distinct receipt.
- Reported error, throw, and timeout each produced a terminal failed MCP item containing the exact host receipt and outcome.
- Exact side-channel cancellation of the active invocation produced host outcome `cancelled`, a terminal provider item, and the same receipt.
- A receipt survived process restart and `thread/read`.
- `thread/resume` accepted a new invocation, and its receipt remained in subsequent durable history.
- A profile-switch mismatch was detected rather than silently attributed.
- A direct bearer-credential invocation entered the host but remained unpaired/session Unknown.
- Duplicate provider events were deduplicated.
- A stale runtime-generation event was rejected.
- A conflicting second session route was quarantined.

The sanitized reduction contained nine exact pairs, one deliberate Unknown execution (direct credential), one deliberate profile mismatch, one deduplicated event, one rejected stale event, and one quarantined conflict.

## Cancellation boundary

The passing cancellation sequence is:

1. observe validated host entry and retain its private invocation ID;
2. cancel that exact host invocation through the host side channel;
3. consume the host's `cancelled` receipt in the terminal MCP item;
4. stop/interrupt the provider turn only if it does not terminate naturally.

A provider interrupt issued before the side-channel outcome did not retain a receipt in the bounded observation window. Production must not label that case session-scoped Cancelled. If product semantics require provider-first interruption, it must preserve the Unknown fallback unless another exact provider receipt appears.

## Production implications

- Add `default_tools_approval_mode: "approve"` to Codex config generated **only** for app-managed Capability MCP servers.
- Parse receipts from terminal `item/completed` MCP items and from `thread/read`; never use partial `item/started` state.
- Register the app session route before starting the turn.
- Keep receipt values, provider thread IDs, credentials, prompts, outputs, raw events, and private paths out of durable application telemetry.
- Preserve Worktree-scoped Used/session Unknown for direct credential access, conflicts, stale generations, missing terminal items, missing receipts, and provider-first cancellation without a retained receipt.
- Quarantine runtime/profile mismatches even when the session route itself is proven.

## Reproduction

Requires a locally authenticated Codex 0.154.0 installation. The probe uses a temporary private `CODEX_HOME`; `--existing-auth` symlinks only the local auth file into that temporary namespace and never emits it.

```bash
node src/main/capabilities/prototype-codex-terminal-capability-receipt/run-transport.mjs --existing-auth
node src/main/capabilities/prototype-codex-terminal-capability-receipt/run.mjs --existing-auth
npm test -- src/main/capabilities/prototype-codex-terminal-capability-receipt/stateful-host.test.ts
```

## Privacy

Committed evidence contains booleans, counts, stable scenario labels, terminal statuses, and the pinned provider version only. It excludes prompts, model output, credentials, tokens, private paths, raw receipts, provider session IDs, host invocation IDs, raw provider events, and Skill content.
