// THROWAWAY #70: local process-capacity measurements. No prompts, outputs, credentials, paths, or session identities are recorded.
import { execFile, execFileSync, spawn } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os, { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
};
const round = (value) => Math.round(value * 10) / 10;
const root = await mkdtemp(join(tmpdir(), "aw-runtime-capacity-"));
const owned = new Set();

async function namespace(index) {
  const base = join(root, String(index));
  for (const name of ["home", "codex", "config", "data", "cache", "state", "work"]) {
    await mkdir(join(base, name), { recursive: true, mode: 0o700 });
  }
  return {
    cwd: join(base, "work"),
    env: {
      PATH: process.env.PATH,
      HOME: join(base, "home"),
      CODEX_HOME: join(base, "codex"),
      XDG_CONFIG_HOME: join(base, "config"),
      XDG_DATA_HOME: join(base, "data"),
      XDG_CACHE_HOME: join(base, "cache"),
      XDG_STATE_HOME: join(base, "state"),
      TMPDIR: root,
      OPENCODE_DISABLE_EXTERNAL_SKILLS: "true",
      OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "true",
      OPENCODE_DISABLE_PROJECT_CONFIG: "true",
      OPENCODE_CONFIG_CONTENT: JSON.stringify({ skills: { paths: [] }, plugin: [], permission: { "*": "deny" } }),
    },
  };
}

function startProcess(command, args, ns) {
  const process = spawn(command, args, { cwd: ns.cwd, env: ns.env, stdio: ["pipe", "pipe", "pipe"] });
  process.stderr.resume();
  owned.add(process);
  process.once("exit", () => owned.delete(process));
  return process;
}

async function processTreeRssKb(rootPid) {
  const { stdout } = await execFileAsync("ps", ["-axo", "pid=,ppid=,rss="]);
  const rows = stdout.trim().split("\n").flatMap((line) => {
    const [pid, ppid, rss] = line.trim().split(/\s+/).map(Number);
    return Number.isFinite(pid) && Number.isFinite(ppid) && Number.isFinite(rss) ? [{ pid, ppid, rss }] : [];
  });
  const ids = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) if (ids.has(row.ppid) && !ids.has(row.pid)) { ids.add(row.pid); changed = true; }
  }
  return rows.filter((row) => ids.has(row.pid)).reduce((sum, row) => sum + row.rss, 0);
}

async function terminate(process, graceMs = 5000) {
  if (process.exitCode !== null || process.signalCode !== null) return { durationMs: 0, forced: false };
  const started = performance.now();
  let exited = false;
  let forced = false;
  const done = new Promise((resolve) => process.once("exit", () => { exited = true; resolve(); }));
  process.kill("SIGTERM");
  await Promise.race([done, pause(graceMs)]);
  if (!exited) { forced = true; process.kill("SIGKILL"); await done; }
  return { durationMs: round(performance.now() - started), forced };
}

function codexRpc(process) {
  let nextId = 0;
  const pending = new Map();
  createInterface({ input: process.stdout }).on("line", (line) => {
    try {
      const message = JSON.parse(line);
      if (message.id !== undefined && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      }
    } catch { /* Ignore non-protocol output. */ }
  });
  return async (method, params) => {
    const id = ++nextId;
    const response = new Promise((resolve) => pending.set(id, resolve));
    process.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    const message = await Promise.race([response, pause(20000).then(() => ({ error: true }))]);
    if (message.error) throw new Error("codex-protocol-failure");
    return message.result;
  };
}

async function launchCodex(ns) {
  const started = performance.now();
  const process = startProcess("codex", ["app-server"], ns);
  const call = codexRpc(process);
  await call("initialize", { clientInfo: { name: "runtime_capacity_probe", version: "1" }, capabilities: { experimentalApi: true } });
  await call("skills/extraRoots/set", { extraRoots: [] });
  const catalogStarted = performance.now();
  const catalog = await call("skills/list", { cwds: [ns.cwd], forceReload: true });
  return {
    provider: "codex",
    process,
    readyMs: round(performance.now() - started),
    verificationMs: round(performance.now() - catalogStarted),
    baselineCount: catalog.data?.flatMap((group) => group.skills ?? []).length ?? 0,
  };
}

async function launchOpenCode(ns) {
  ns.env.OPENCODE_SERVER_USERNAME = "benchmark";
  ns.env.OPENCODE_SERVER_PASSWORD = "local-benchmark-only";
  const started = performance.now();
  const process = startProcess("opencode", ["serve", "--hostname", "127.0.0.1", "--port", "0"], ns);
  let output = "";
  let baseUrl;
  process.stdout.on("data", (chunk) => {
    output += chunk;
    baseUrl = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
  });
  const deadline = Date.now() + 20000;
  while (!baseUrl && process.exitCode === null && Date.now() < deadline) await pause(50);
  if (!baseUrl) throw new Error("opencode-startup-failure");
  const verificationStarted = performance.now();
  const response = await fetch(`${baseUrl}/skill`, {
    headers: { Authorization: `Basic ${Buffer.from("benchmark:local-benchmark-only").toString("base64")}` },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error("opencode-verification-failure");
  const catalog = await response.json();
  return {
    provider: "opencode",
    process,
    readyMs: round(performance.now() - started),
    verificationMs: round(performance.now() - verificationStarted),
    baselineCount: catalog.length,
  };
}

const launchers = { codex: launchCodex, opencode: launchOpenCode };
async function measureLaunch(provider, ns, phase) {
  const runtime = await launchers[provider](ns);
  const readyRssMb = round((await processTreeRssKb(runtime.process.pid)) / 1024);
  await pause(2000);
  const idleRssMb = round((await processTreeRssKb(runtime.process.pid)) / 1024);
  const shutdown = await terminate(runtime.process);
  return { provider, phase, readyMs: runtime.readyMs, verificationMs: runtime.verificationMs, readyRssMb, idleRssMb, baselineCount: runtime.baselineCount, shutdownMs: shutdown.durationMs, forcedShutdown: shutdown.forced };
}

async function series(provider, repetitions) {
  const ns = await namespace(`series-${provider}`);
  const rows = [];
  rows.push(await measureLaunch(provider, ns, "cold"));
  for (let index = 1; index < repetitions; index += 1) rows.push(await measureLaunch(provider, ns, "warm"));
  return rows;
}

async function mixed(count) {
  const providers = Array.from({ length: count }, (_, index) => index % 2 === 0 ? "codex" : "opencode");
  const started = performance.now();
  const runtimes = await Promise.all(providers.map(async (provider, index) => launchers[provider](await namespace(`mixed-${count}-${index}`))));
  const rssMb = round((await Promise.all(runtimes.map((runtime) => processTreeRssKb(runtime.process.pid)))).reduce((sum, value) => sum + value, 0) / 1024);
  const readyMs = round(performance.now() - started);
  await pause(1000);
  await Promise.all(runtimes.map((runtime) => terminate(runtime.process)));
  return { count, providers, wallReadyMs: readyMs, aggregateReadyRssMb: rssMb };
}

async function crashRestart(provider) {
  const ns = await namespace(`crash-${provider}`);
  const first = await launchers[provider](ns);
  first.process.kill("SIGKILL");
  await new Promise((resolve) => first.process.once("exit", resolve));
  const restarted = await launchers[provider](ns);
  const result = { provider, restartReadyMs: restarted.readyMs, restartVerificationMs: restarted.verificationMs, restartRssMb: round((await processTreeRssKb(restarted.process.pid)) / 1024) };
  await terminate(restarted.process);
  return result;
}

async function forcedShutdown(provider) {
  const runtime = await launchers[provider](await namespace(`forced-${provider}`));
  runtime.process.kill("SIGSTOP");
  const shutdown = await terminate(runtime.process, 250);
  return { provider, graceMs: 250, durationMs: shutdown.durationMs, forced: shutdown.forced };
}

function queueSimulation(capacity, durations) {
  const slots = Array.from({ length: capacity }, () => 0);
  const waits = [];
  for (const duration of durations) {
    let slot = 0;
    for (let index = 1; index < slots.length; index += 1) if (slots[index] < slots[slot]) slot = index;
    waits.push(slots[slot]);
    slots[slot] += duration;
  }
  return { capacity, p50WaitMs: round(percentile(waits, 0.5)), p95WaitMs: round(percentile(waits, 0.95)), maxWaitMs: round(Math.max(...waits)) };
}

try {
  const repetitions = Number(process.env.AW_BENCH_REPETITIONS ?? 3);
  const versions = Object.fromEntries(["codex", "opencode"].map((provider) => {
    try { return [provider, execFileSync(provider, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()]; }
    catch { return [provider, "unavailable"]; }
  }));
  const launches = [...await series("codex", repetitions), ...await series("opencode", repetitions)];
  const mixedLoads = [];
  for (const count of [1, 2, 4]) mixedLoads.push(await mixed(count));
  const restarts = [await crashRestart("codex"), await crashRestart("opencode")];
  const forcedShutdowns = [await forcedShutdown("codex"), await forcedShutdown("opencode")];
  const startupDurations = launches.map((row) => row.readyMs + row.verificationMs);
  const queue = [1, 2, 4].map((capacity) => queueSimulation(capacity, [...startupDurations, ...startupDurations]));
  const output = {
    kind: "local-runtime-capacity-benchmark",
    machine: { platform: os.platform(), release: os.release(), arch: os.arch(), logicalCpus: os.cpus().length, cpuModel: os.cpus()[0]?.model ?? "unknown", totalMemoryGb: round(os.totalmem() / 1024 ** 3), node: process.version },
    versions,
    policyUnderTest: { totalCapacity: 4, perProviderCapacity: 4, idleMs: 60000, perRuntimeTurnConcurrency: 1 },
    launches,
    mixedLoads,
    crashRestarts: restarts,
    forcedShutdowns,
    queueSimulation: queue,
    privacy: { prompts: false, outputs: false, skillNames: false, paths: false, tokens: false, sessionIdentifiers: false },
    turnConcurrencyQualification: "not-qualified-pending-independent-routing-and-cancellation-proof",
  };
  console.log(JSON.stringify(output, null, 2));
} finally {
  for (const process of owned) await terminate(process, 1000);
  await rm(root, { recursive: true, force: true });
}
