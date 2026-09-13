# Throwaway #70 — Worktree Runtime capacity benchmark

## Recommendation

Use these approved first-release constants:

- **Total Worktree Runtime capacity:** 4 on every supported machine, including machines below 12 GB.
- **Per-provider capacity:** 4, within the same global ceiling.
- **Idle timeout:** 60 seconds for both providers; memory pressure reduces it immediately to zero.
- **Per-runtime active turn concurrency:** 1 until independent session routing and cancellation are qualified.
- **Graceful shutdown deadline:** retain 5 seconds, then terminate only the tracked owned process tree.

These replace the provisional five-minute idle window. The benchmark's conservative engineering recommendation was two slots, but HITL explicitly selected four slots without a low-memory reduction to maximize parallel worktrees. This accepts the measured risk that four mixed runtimes exceeded 1 GB before Electron, terminals and repositories are counted. The short idle window and immediate memory-pressure eviction are therefore mandatory safeguards.

## Artifacts and usage

All artifacts are throwaway evidence on branch `prototype/runtime-capacity-benchmark`. No production service, schema or UI route is modified.

- `benchmark.mjs` — launches real Codex/OpenCode processes in private temporary namespaces and emits aggregate measurements.
- `observed.json` — one reviewed local run.
- `index.html` — double-clickable policy model with seven guided scenarios.

Run from repository root:

```sh
node src/main/coding-agents/prototype-runtime-capacity/benchmark.mjs
open src/main/coding-agents/prototype-runtime-capacity/index.html
```

Set `AW_BENCH_REPETITIONS` to change the default three launch samples per provider. The harness records no prompts, outputs, Skill names, paths, tokens or session identifiers and does not access provider authentication.

## Measurement context

The committed observation is machine-specific, not universal performance telemetry:

- macOS Darwin 25.6.0, arm64.
- Apple M5, 10 logical CPUs.
- 16 GB physical memory.
- Node 24.3.0.
- Codex CLI 0.154.0.
- OpenCode CLI 1.18.30.

Every runtime used a private HOME/config/data/cache/state namespace, empty Skill projection and minimal plugin-free configuration. Ready includes provider handshake; verification enumerates the effective Skill catalog. RSS includes the provider root process and all descendants visible to `ps`.

## Observations

### Startup and verification

| Provider | Cold ready | Warm ready range | Verification range | Restart after crash |
|---|---:|---:|---:|---:|
| Codex | 70 ms | 44–47 ms | 4–8 ms | 40 ms + 4 ms verification |
| OpenCode | 582 ms | 435–440 ms | 26–123 ms | 433 ms + 26 ms verification |

OpenCode startup variance is significant, so no SLA should use the fastest sample. Even its slowest observed crash restart remained under two seconds on this machine.

### Memory

| Workload | Aggregate RSS |
|---|---:|
| One Codex runtime | 107 MB |
| Codex + OpenCode | 512 MB |
| Two Codex + two OpenCode | 1,022 MB |

Individual idle ranges were approximately:

- Codex: 118–128 MB.
- OpenCode: 368–549 MB.

The provider mix dominates memory more than CPU count. A global capacity of two bounds the observed provider overhead to roughly 0.75 GB for the worst same-provider mix inferred from two steady OpenCode runtimes, while permitting two simultaneous worktrees.

### Queue simulation

The deterministic queue replayed the six measured startup+verification durations twice:

| Capacity | p50 wait | p95/max wait |
|---:|---:|---:|
| 1 | 1.82 s | 3.16 s |
| 2 | 0.78 s | 1.49 s |
| 4 | 0.08 s | 0.52 s |

Capacity four improves synthetic queue latency and was selected despite crossing 1 GB for the measured mixed workload. Queue figures are policy comparisons, not user latency promises; actual turns can hold leases much longer than startup.

### Shutdown and crash

Normal provider shutdown completed in 4–9 ms in the final series and never required SIGKILL. A deliberately stopped Codex process exercised the forced fallback after the 250 ms test grace. OpenCode exited on SIGTERM despite the stop attempt, so its forced branch was not observed. The production five-second deadline remains deliberately much larger than normal measurements and protects provider persistence/drain behavior not modeled here.

Both providers restarted in the same private namespace after SIGKILL and completed catalog verification. The benchmark does not claim provider-session resume; durable resume correctness remains a separate gate.

## Policy rationale

### Why four total slots

- One slot doubles synthetic p95 startup queue wait and prevents parallel worktrees entirely.
- Four slots reduce the measured synthetic p95 startup wait to 0.52 seconds and permit four parallel worktree/provider runtimes.
- Four mixed runtimes consumed 1.07 GB in the sample, so the selected policy favors parallelism over the benchmark's conservative two-slot recommendation.
- Per-provider and total limits remain centralized so later qualified measurements can lower constants without changing lifecycle semantics.

There is deliberately no low-memory fallback: HITL selected four slots even below 12 GB. Memory-pressure handling must immediately evict every idle runtime and pause new startups, while preserving busy work.

### Why 60 seconds idle

Codex restarts quickly and OpenCode retains hundreds of megabytes while idle. A short warm window covers immediate navigation/retry without retaining every visited worktree for five minutes. Any memory-pressure event evicts idle LRU entries immediately and pauses startup; busy runtimes are never selected for eviction.

### Why one active turn

This benchmark intentionally submits no prompts and records no model data. Process throughput cannot prove that provider events, approvals and cancellation remain session-scoped under concurrent turns. Until the provider session-pairing/cancellation proof succeeds, every runtime uses a cancellable local FIFO with one active turn. A later qualification may raise this limit per provider/version without changing global process capacity.

## Limits and release gate

- Measurements cover one Apple Silicon machine and three launch samples per provider. Repeat on the oldest supported macOS hardware and at least one 8 GB machine before final packaging.
- RSS from `ps` is an operational approximation, not proportional set size; shared pages may be counted more than once.
- No long-lived model turns, terminal workloads or Electron renderer pressure were measured.
- OpenCode showed startup variance; release tests should use p95 across more samples.
- Forced OpenCode escalation was not observed and needs a deterministic owned-process fixture or a genuinely hung provider case.
- Same-runtime turn concurrency remains unqualified by design.

The approved constants are product defaults, not a claim that four slots are low-risk on every machine. Packaging verification must explicitly exercise memory pressure on constrained hardware; changing the four-slot policy requires a new product decision supported by equivalent repeatable measurements.
