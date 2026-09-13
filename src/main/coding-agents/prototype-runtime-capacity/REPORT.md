# Throwaway #70 — Worktree Runtime capacity benchmark

## Recommendation

Use these first-release constants:

- **Total Worktree Runtime capacity:** 2 on machines with at least 12 GB physical memory; 1 below 12 GB.
- **Per-provider capacity:** equal to total capacity, with the same global ceiling.
- **Idle timeout:** 60 seconds for both providers; memory pressure reduces it immediately to zero.
- **Per-runtime active turn concurrency:** 1 until independent session routing and cancellation are qualified.
- **Graceful shutdown deadline:** retain 5 seconds, then terminate only the tracked owned process tree.

These replace the provisional five-minute idle window. On the measured machine, keeping two idle OpenCode processes warm for five minutes would retain roughly 736 MB to save a typical sub-second restart. Two total slots materially reduce queue wait compared with one while avoiding the >1 GB provider footprint observed with four mixed runtimes.

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
| Codex | 184 ms | 50–59 ms | 4–10 ms | 103 ms + 9 ms verification |
| OpenCode | 617 ms | 440–1,021 ms | 26–147 ms | 1,681 ms + 125 ms verification |

OpenCode startup variance is significant, so no SLA should use the fastest sample. Even its slowest observed crash restart remained under two seconds on this machine.

### Memory

| Workload | Aggregate RSS |
|---|---:|
| One Codex runtime | 110 MB |
| Codex + OpenCode | 537 MB |
| Two Codex + two OpenCode | 1,073 MB |

Individual idle ranges were approximately:

- Codex: 122–128 MB.
- OpenCode: 366–460 MB.

The provider mix dominates memory more than CPU count. A global capacity of two bounds the observed provider overhead to roughly 0.75 GB for the worst same-provider mix inferred from two steady OpenCode runtimes, while permitting two simultaneous worktrees.

### Queue simulation

The deterministic queue replayed the six measured startup+verification durations twice:

| Capacity | p50 wait | p95/max wait |
|---:|---:|---:|
| 1 | 2.59 s | 4.72 s |
| 2 | 1.25 s | 2.20 s |
| 4 | 0.19 s | 0.76 s |

Capacity four improves synthetic queue latency but crosses 1 GB for the measured mixed workload. Capacity two is the conservative balance. Queue figures are policy comparisons, not user latency promises; actual turns can hold leases much longer than startup.

### Shutdown and crash

Normal provider shutdown completed in 8–57 ms in the final series and never required SIGKILL. A deliberately stopped Codex process exercised the forced fallback after the 250 ms test grace. OpenCode exited on SIGTERM despite the stop attempt, so its forced branch was not observed. The production five-second deadline remains deliberately much larger than normal measurements and protects provider persistence/drain behavior not modeled here.

Both providers restarted in the same private namespace after SIGKILL and completed catalog verification. The benchmark does not claim provider-session resume; durable resume correctness remains a separate gate.

## Policy rationale

### Why two total slots

- One slot doubles synthetic p95 startup queue wait and prevents parallel worktrees entirely.
- Four slots reduce startup queue wait but permit >1 GB of provider processes before Electron, repositories, terminals and model tooling are counted.
- Two slots support the primary parallel-worktree workflow while keeping a straightforward global ownership bound.
- Per-provider and total limits remain centralized so later qualified measurements can change constants without changing lifecycle semantics.

For machines below 12 GB, the fallback capacity is one because this single 16 GB sample cannot establish safe headroom for two OpenCode runtimes under application load. This is a conservative admission policy, not adaptive analytics.

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

The fallback constants above are safe specification defaults. Packaging qualification may lower capacity or timeout for a constrained platform, but must never raise them without equivalent repeatable measurements.
