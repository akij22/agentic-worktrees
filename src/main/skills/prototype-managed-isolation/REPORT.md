# Throwaway #69 — Managed Skill isolation

## Verdict

**The approved cross-provider Managed Skill isolation contract is not yet qualified end to end. Keep prompt admission closed.**

OpenCode 1.18.30 is conditionally enforceable with private config/data/state, disabled external/project discovery, immutable content-addressed projections, exact `/skill` and `/command` snapshots, per-Skill loader permission, collision rejection and pre-turn verification. Codex 0.154.0 remains the blocking provider: Skill roots are additive, ambient project/home Skills appear live, and per-path disable plus `skills/changed` does not provide an atomic catalog-to-turn boundary. The probe did not prove that an unexpected Skill cannot become usable between verification and context construction.

The result does not justify weakening the contract. A provider/version remains unavailable until its effective managed channels are version-qualified. Application-side denial prevents explicit bypasses; it does not turn an unverified automatic provider catalog into a safe one.

## Artifacts and usage

Everything in this directory is throwaway prototype evidence on branch `prototype/managed-skill-isolation`. No production module, schema or renderer route is modified.

- `probe.mjs` — live local Codex/OpenCode protocol probe using synthetic inert Skill documents and private temporary namespaces.
- `index.html` — double-clickable admission-state model with twelve guided scenarios.
- `observed.json` — reviewed both-provider run with existing CLI auth links and OpenCode's public model.
- `observed-public.json` — successful OpenCode public-model loader/command observations.
- `observed-denied.json` — OpenCode run with every builtin Skill load denied.
- `unsupported.json` — fail-closed version mismatch fixture.

From the repository root:

```sh
node src/main/skills/prototype-managed-isolation/probe.mjs --existing-auth --public-model
node src/main/skills/prototype-managed-isolation/probe.mjs --opencode-only --public-model
node src/main/skills/prototype-managed-isolation/probe.mjs --opencode-only --public-model --deny-skills
node src/main/skills/prototype-managed-isolation/probe.mjs --unsupported-version
open src/main/skills/prototype-managed-isolation/index.html
```

`--existing-auth` only links known CLI-owned auth files into temporary private namespaces. The launcher never reads or emits credential values. Output contains provider/version, opaque generation/digests, counts and outcome categories—never Skill bodies, prompts, tokens or private paths. Every owned process and temporary directory is cleaned up.

## Reproducibility

Reviewed application base: `a6ff2de`.

Observed locally with:

- Node 24.3.0.
- Codex CLI 0.154.0.
- OpenCode CLI 1.18.30.

The probe creates two logical worktree namespaces A/B, disjoint immutable Skill snapshots, an updated snapshot, synthetic ambient roots and collisions. It exercises real `codex app-server` and `opencode serve` contracts with inert Skill instructions. It is not production admission code and does not claim an operating-system sandbox.

## Common enforceable boundary

Before any provider call, the application can enforce these provider-independent rules:

1. resolve explicit Skill names, paths, aliases and commands against one immutable Assignment generation;
2. reject absent, stale, ambiguous or cross-worktree identities before provider submission;
3. validate a content-addressed snapshot's identity, complete digest, read-only permissions, directory contents, real paths and absence of escaping links;
4. reject duplicate raw/transformed names and config-command shadows before launch;
5. reject unexpected plugins or commands outside the version-qualified provider baseline;
6. verify exact provider/catalog generation before create, resume and every turn;
7. close admission on version mismatch, corruption, drift or unverifiable catalog state.

The probe observed zero submissions for all synthetic application bypass attempts (`native-name`, `native-path`, `command`, `alias`) and detected stale generation, permission corruption and digest corruption for both providers.

## Codex 0.154.0

### What worked

- Private `HOME`/`CODEX_HOME` plus one extra root produced disjoint A/B catalogs: B included its assigned Skill and did not include A.
- Native explicit B input completed and its private rollout contained exactly B's document.
- Deliberately submitting A's foreign path directly to raw Codex recorded the native request but produced no A context injection in this version. This is useful observation, not an application authorization boundary.
- Catalog and thread resume survived app-server restart.
- `skills/changed` fired after synthetic ambient mutation.
- `skills/config/write` disabled the two targeted synthetic ambient Skills; later catalog enumeration reported neither enabled.
- Immutable generation replacement, duplicate detection and snapshot corruption checks behaved as expected.

### Why qualification remains closed

- An empty private namespace still exposed six provider baseline Skills. These can be accepted only as a pinned reviewed built-in baseline, never learned dynamically.
- Adding synthetic project/home Skill sources expanded the live catalog and produced a change notification. The probe later observed many provider entries beyond the one Assignment.
- `skills/extraRoots/set` is additive. Per-path writes can disable known entries, but no atomic primitive binds “this exact enabled catalog” to `turn/start`.
- The probe did not prove ordering for a mutation racing with an active turn, nor that every discovery channel emits a notification before context construction.
- Therefore pre-turn enumeration plus eventual cancellation is detection/recovery, not proof that no unassigned instruction entered context.

Codex must remain unavailable for strict Managed Skill isolation until one of these is proven: a provider-supported exclusive catalog/transaction; a version-qualified automatic-loading disable that covers every ambient source while explicit native input remains controlled; or a stronger trusted mediation boundary. Raw foreign-path behavior alone is not sufficient and must not become policy.

## OpenCode 1.18.30

### What worked

- Private XDG roots plus external/Claude/project-discovery disable flags yielded one built-in baseline entry when empty and exactly built-in + assigned Skill for disjoint A/B catalogs.
- B did not enumerate A. Unassigned application names/paths/commands were denied before provider submission.
- `/command` resolved exactly one B Skill template and no A command.
- With the public model, explicit B command injection and model-selected builtin loading succeeded. A prompt naming unassigned A did not load A; it could only load the available B Skill.
- With deny-all Skill permission, builtin loads dropped to zero while explicit command template injection remained possible. Loader permission and command resolution are separate channels and must both be verified.
- Restart retained the provider session; immutable generation replacement was observable.
- Config-command shadowing was deterministic and detectable before admission.
- Snapshot permission/digest corruption was detected.

### Remaining qualification gates

- The built-in entry requires a pinned identity/content baseline; a changed baseline closes admission.
- Synthetic project/home mutation was not discovered live under the disable flags, but a Skill later placed in private OpenCode config appeared after a new generation/restart. Exact restart/pre-turn catalog verification catches it only if the config namespace remains application-owned and immutable.
- No catalog-change notification was observed. Production must not depend on watcher events for OpenCode safety.
- Qualification therefore requires immutable private config/projection ownership and exact enumeration immediately before provider work. Any mutation or unexplained extra entry closes admission and recreates the runtime.
- Repository SDK/provider CLI versions must be aligned or explicitly qualified before generated contracts are trusted.

OpenCode is a viable implementation path once those baseline and namespace conditions are captured as executable version fixtures. It does not make the overall two-provider requirement complete while Codex remains unqualified.

## Collision, update and recovery policy

- Duplicate Skill names, transformed-name collisions and config command shadows are rejected by the application before provider launch; provider precedence is never accepted as identity.
- Every update creates a new immutable generation. Old callbacks and sessions cannot activate it.
- Restart uses the same private namespace but never reuses an admission decision; catalog, commands, baseline and generation are reverified before resume.
- Watcher drift, unexpected entries, baseline mismatch or corruption close new admission. If an active turn could have observed drift and unchanged effective context cannot be proven, cancel it and enter Recovery required.
- Rebuild only from verified installed content, then reverify. Never fall back to a corrupt or merely latest copy.

## Security boundary

This is managed-channel isolation, not filesystem confidentiality. The probe intentionally confirms that the same operating-system identity can read the other synthetic snapshot as an ordinary file. Such access remains governed by provider tool permissions and must not be reported as managed Skill Used.

Private namespaces prevent accidental inheritance; they do not defend against a compromised same-user process. The app must never expose auth, Skill contents or private paths to the renderer or diagnostics.

## HITL decision

The prototype supports three possible product responses:

1. **Strict qualification gate (recommended):** implement only after both provider adapters satisfy version-pinned all-channel proofs; keep Codex unavailable until its catalog-to-turn race is closed.
2. **Provider-specific availability:** ship OpenCode after its fixture gates pass while showing Codex as unavailable for Managed Skills. This violates the requested first-release parity.
3. **Weaken isolation:** rely on pre-turn checks and watcher cancellation for Codex. The prototype rejects this because it changes the already approved guarantee.

The HTML starts closed and allows a hypothetical proof only as a clearly labelled model action. It demonstrates expected admission/recovery behavior but never presents that assumption as a live result.
