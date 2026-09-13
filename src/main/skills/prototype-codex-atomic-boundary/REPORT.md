# Throwaway #72 — Atomic Codex Skill catalog-to-turn boundary

## Verdict

**Codex 0.154.0 does not expose an atomic exclusive Skill catalog that satisfies Managed Skill isolation. Keep Codex Managed Skill admission closed.**

`skills.include_instructions = false` is useful but insufficient. It suppresses the automatic available-Skills instructions block while preserving application-controlled native Skill input. However, a textual `$skill-name` mention still resolves and injects an ambient Skill from Codex's discovered catalog. Path-based disables block Skills known before thread creation, but a Skill created after verification and before `thread/start` bypassed that deny-list and entered context. Resume also rediscovered and injected an ambient Skill that appeared after the original thread was created.

The observed race is the exact missing catalog-to-turn transaction from #69. Watcher detection, force reload, disable writes and later cancellation cannot prove that foreign instructions did not enter context.

## Artifacts and usage

All files are throwaway evidence on branch `prototype/codex-atomic-skill-boundary`; production files and protocols are unchanged.

- `probe.mjs` — live Codex app-server probe in a temporary private namespace.
- `observed.json` — sanitized reviewed result.
- `index.html` — self-contained boundary model and guided walkthroughs.

From repository root:

```sh
node src/main/skills/prototype-codex-atomic-boundary/probe.mjs --existing-auth
open src/main/skills/prototype-codex-atomic-boundary/index.html
```

The auth flag creates one temporary symlink to the known Codex CLI auth file. The launcher never reads or prints it. Output contains only version, counts and booleans—no prompts, outputs, Skill bodies, credentials, paths or session IDs. All provider processes and scratch files are owned and removed by the probe.

## Reproducibility

Reviewed application base: `a6ff2de`.

Observed with:

- Node 24.3.0.
- Codex CLI 0.154.0.
- Codex app-server JSON-RPC.
- Synthetic inert Skill files only.

The process receives private `HOME`, `CODEX_HOME`, cwd and one application-managed extra root. The probe starts threads with:

```text
skills.include_instructions = false
skills.bundled.enabled = false
skills.config = [{ path = <known foreign path>, enabled = false }, ...]
```

Exact private rollout records are inspected for synthetic document equality; only aggregate counts are emitted.

## Pinned primary-source findings

The findings below refer to OpenAI Codex tag [`rust-v0.154.0`](https://github.com/openai/codex/tree/rust-v0.154.0):

- [`config.schema.json`](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/config.schema.json) defines `skills.include_instructions`, `skills.bundled.enabled`, and path/name-based `skills.config` entries. `include_instructions` controls whether turns receive the automatic Skills instructions block; it is not an exclusive-root control.
- [`thread.rs`](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/app-server-protocol/src/protocol/v2/thread.rs) allows a config map on thread start/resume/fork, but not a selected immutable Skill catalog or catalog generation on `turn/start`.
- [`host_roots.rs`](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/ext/skills/src/host_roots.rs) composes roots from user, home `.agents/skills`, system, project/config layers, plugins, runtime extra roots and every `.agents/skills` directory from project root to cwd. Extra roots are additive.
- [`host_service.rs`](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/ext/skills/src/host_service.rs) resolves disables after discovery and caches snapshots by config/root state. The public service can replace runtime extra roots, but it still adds the ambient roots resolved above.
- [`skills_watcher.rs`](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/app-server/src/skills_watcher.rs) clears caches and emits `skills/changed` after a throttled watcher event. The production throttle is ten seconds; this is detection after filesystem change, not turn admission atomicity.
- [`model.rs`](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/skills/src/model.rs) defaults implicit invocation to allowed when Skill metadata does not opt out. An ambient author therefore need not supply an opt-in policy.

No pinned schema or protocol field provides exclusive roots, an application-supplied catalog digest, or explicit-native-input-only loading.

## Observed matrix

| Scenario | Result |
|---|---|
| Private process plus one assigned extra root | Assigned Skill appeared; six bundled/baseline Skills still appeared in raw enumeration |
| `bundled.enabled=false` + `include_instructions=false`, native assigned input | Exact assigned document entered context once; automatic catalog block was absent |
| Same config, generic automatic prompt | No assigned or ambient document entered context |
| Ambient Skill exists before thread start, textual `$ambient-before` mention | Exact foreign document entered context once despite hidden automatic catalog |
| Same ambient path listed disabled in thread config | Foreign document did not enter context |
| Verify catalog, build disables, create a new ambient Skill, then start thread | Newly created unlisted foreign document entered context once |
| Create foreign Skill after an already-created strict thread, force reload, then mention | No injection in the reviewed thread snapshot |
| Restart and resume that thread with strict config lacking the new path, then mention | Exact new foreign document was present in two context records |
| Three create-after-`turn/start` races, one interrupted | No foreign document entered in this sample; this does not repair the proven pre-start race |

The successful gap bypass is deterministic: the disabled set came from an exact force-reloaded catalog, then a new path was created before `thread/start`. The thread's config could not disable a path it did not know. `$ambient-between-verify-start` loaded it through a managed Skill channel.

## Why mitigations are insufficient

### Hide automatic instructions

This prevents model selection from the advertised catalog and should be part of any future configuration. It does not disable mention resolution or remove ambient Skills from provider state.

### Disable every enumerated foreign path

This works for known paths and is a useful defense-in-depth check. Enumeration and `thread/start` are separate requests. A new path in between is discovered by thread construction and is not covered by the prior deny-list.

### Watch and cancel

The watcher is throttled and reports change after mutation. Even an immediate notification would not prove ordering against context construction. Cancellation cannot erase instructions already admitted to a turn or provider history.

### Freeze one thread snapshot

The same-thread observation suggests a useful immutable snapshot lifetime, but new session creation and resume are admission operations. The resume result proves they rediscover ambient state. Assignment changes also need new verified generations, so indefinitely preserving an old thread is not a general solution.

### Filter `$name` text in the renderer

Prompt text is not a trusted authorization grammar. Aliases, future syntax, nested agents, provider-generated messages and protocol changes make text filtering incomplete. Managed access must be enforced at the provider boundary, not approximated by UI sanitation.

## Minimum stronger boundary

The smallest provider-level contract is an **exclusive selected Skill snapshot** supplied atomically on thread start/resume/fork and retained for every turn:

1. application passes immutable selected entries `{resourceId, name, canonicalPath, digest}` plus a generation;
2. provider constructs Skill selection only from those entries—no user, project, system, plugin, home or extra-root union;
3. all implicit, mention, native input, subagent and future Skill channels resolve against that snapshot;
4. provider rejects path/name input outside the snapshot before reading the document;
5. response and history expose the selected generation/digest for verification;
6. resume/fork require an explicit matching snapshot or fail closed;
7. changing the snapshot requires a new admitted thread/runtime generation.

An `explicitOnly` mode could also qualify if it disables every implicit/mention/automatic/provider-generated path and accepts native Skill input only after membership/digest verification. Merely hiding instructions is not explicit-only mode.

Without a provider change, the alternative is a separately proven OS/filesystem mediation topology in which Codex cannot observe ambient discovery roots while still operating correctly on the real target worktree. That would be managed-channel mediation, not a claim of filesystem confidentiality. It is not proven here and carries significant cross-platform/runtime complexity.

## Admission and recovery contract

For Codex 0.154.0:

- Managed Skill provider qualification: unavailable.
- Prompt/session/resume admission requiring assigned Skills: closed.
- Detection of unexpected catalog entries: enter Recovery required; never continue best-effort.
- An already-started turn overlapping detected drift: cancel and retain isolation status Unknown; do not claim it remained clean.
- Explicit Skill availability in product UI: do not advertise until an exclusive boundary qualifies.

## HITL recommendation

Choose one:

1. **Require provider atomic snapshot support (recommended):** preserve cross-provider parity and strict isolation; block Codex Managed Skills until Codex exposes and passes the contract above.
2. **Prototype OS/filesystem mediation:** open a separate proof ticket for a cross-platform topology that masks every ambient root while preserving real-worktree operation.
3. **Ship OpenCode only:** allow provider-specific availability, contrary to the approved first-release parity requirement.

Do not approve watcher/deny-list best effort. The live pre-start gap demonstrates foreign context entry under that design.
