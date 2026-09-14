// THROWAWAY #73: live providers plus inert receipt bridge. Output is aggregate evidence only.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { correlate, createReceiptBridgeHost, type HostEvidence, type ProviderEvidence } from "./bridge";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const receiptPattern = /AW_RECEIPT:([0-9a-f-]{36})/;
const extractReceipt = (value: unknown) => JSON.stringify(value ?? "").match(receiptPattern)?.[1];
type Rpc = { id?: number; method?: string; params?: Record<string, unknown>; result?: unknown; error?: unknown };
type OpenSession = { id: string };
type OpenMessage = { info?: { error?: unknown }; parts?: Array<{ type?: string; tool?: string; state?: { status?: string; output?: unknown; error?: unknown } }> };

export async function main() {
  const root = await mkdtemp(join(tmpdir(), "aw-receipt-bridge-"));
  const generation = "runtime-generation-current";
  const tokens = [randomBytes(32).toString("hex"), randomBytes(32).toString("hex")] as const;
  const hosts = (["A", "B"] as const).map((lease, index) => createReceiptBridgeHost({ lease, token: tokens[index], runtimeGeneration: generation, timeoutMs: 400 }));
  const ports = await Promise.all(hosts.map((host) => host.start()));
  const leases = (["A", "B"] as const).map((lease, index) => ({ lease, host: hosts[index], port: ports[index], token: tokens[index], server: `aw_${lease.toLowerCase()}` }));
  const children = new Set<ChildProcess>();
  const providerEvidence: ProviderEvidence[] = [];
  const start = (command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) => { const child = spawn(command, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] }); children.add(child); child.stderr?.resume(); child.once("exit", () => children.delete(child)); return child; };
  const stop = async (child: ChildProcess) => { if (child.exitCode !== null || child.signalCode !== null) return; const done = new Promise<void>((resolve) => child.once("exit", () => resolve())); child.kill("SIGTERM"); await Promise.race([done, pause(1500)]); if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await done; } };
  const namespace = async (name: string) => { const base = join(root, name); for (const path of ["home", "codex", "config", "data", "cache", "state", "work"]) await mkdir(join(base, path), { recursive: true, mode: 0o700 }); return { base, cwd: join(base, "work"), env: { PATH: process.env.PATH, HOME: join(base, "home"), CODEX_HOME: join(base, "codex"), XDG_CONFIG_HOME: join(base, "config"), XDG_DATA_HOME: join(base, "data"), XDG_CACHE_HOME: join(base, "cache"), XDG_STATE_HOME: join(base, "state"), TMPDIR: root } as NodeJS.ProcessEnv }; };
  const allHostEvidence = () => hosts.flatMap((host) => host.evidence);
  const observations: Record<string, unknown> = {};

  async function openCodeProbe() {
    const ns = await namespace("opencode");
    const password = randomBytes(24).toString("hex");
    const mcp = Object.fromEntries(leases.map((lease) => [lease.server, { type: "remote", url: `http://127.0.0.1:${lease.port}/mcp`, headers: { Authorization: `Bearer ${lease.token}` } }]));
    const agent = Object.fromEntries(leases.map((lease) => [`profile_${lease.lease.toLowerCase()}`, { mode: "primary", permission: { "aw_*": "deny", [`${lease.server}_*`]: "allow" } }]));
    const env = { ...ns.env, OPENCODE_SERVER_USERNAME: "prototype", OPENCODE_SERVER_PASSWORD: password, OPENCODE_DISABLE_PROJECT_CONFIG: "true", OPENCODE_CONFIG_CONTENT: JSON.stringify({ mcp, agent, plugin: [] }) };
    const launch = async () => { const child = start("opencode", ["serve", "--hostname", "127.0.0.1", "--port", "0"], ns.cwd, env); let output = ""; let baseUrl: string | undefined; child.stdout?.on("data", (chunk) => { output += chunk; baseUrl = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; }); const deadline = Date.now() + 20000; while (!baseUrl && child.exitCode === null && Date.now() < deadline) await pause(50); if (!baseUrl) throw new Error("startup"); return { child, baseUrl }; };
    let runtime = await launch();
    const api = async <T>(path: string, body?: unknown): Promise<T> => { const response = await fetch(`${runtime.baseUrl}${path}`, { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", "x-opencode-directory": ns.cwd, Authorization: `Basic ${Buffer.from(`prototype:${password}`).toString("base64")}` }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000) }); if (!response.ok) throw new Error("api"); const text = await response.text(); return (text ? JSON.parse(text) : undefined) as T; };
    let eventCounter = 0;
    const run = async (session: "A" | "B", lease: typeof leases[number], tool: string, profile = lease, existing?: OpenSession) => {
      const created = existing ?? await api<OpenSession>("/session", {});
      try { await api<unknown>(`/session/${created.id}/message`, { agent: `profile_${profile.lease.toLowerCase()}`, model: { providerID: "opencode", modelID: "big-pickle" }, parts: [{ type: "text", text: `Call ${profile.server}_${tool} exactly once. Do not call any other tool.` }] }); } catch { /* History below is authoritative for retained provider evidence. */ }
      const history = await api<OpenMessage[]>(`/session/${created.id}/message`).catch(() => []);
      const parts = history.flatMap((message) => message.parts ?? []).filter((part) => part.type === "tool");
      const invocationIds: string[] = [];
      for (const part of parts) { const invocationId = extractReceipt(part.state?.output ?? part.state?.error); if (invocationId && part.tool) { invocationIds.push(invocationId); if (!providerEvidence.some((event) => event.invocationId === invocationId && event.session === session)) providerEvidence.push({ provider: "opencode", session, expectedLease: session, runtimeGeneration: generation, invocationId, server: part.tool, eventIdentity: `opencode-event-${++eventCounter}` }); } }
      return { created, invocationIds, receiptCount: invocationIds.length, toolPartCount: parts.length }; 
    };
    const [a, b] = await Promise.all([run("A", leases[0], "receipt_success"), run("B", leases[1], "receipt_success")]);
    const switched = await run("B", leases[1], "receipt_success", leases[0]);
    const retried = await run("A", leases[0], "receipt_success", leases[0], a.created);
    const retryDistinctReceipt = new Set(retried.invocationIds).size >= 2;
    const errorRuns = [];
    for (const tool of ["receipt_reported_error", "receipt_throw", "receipt_timeout"]) errorRuns.push({ tool, ...(await run("A", leases[0], tool)) });
    const resumable = a.created.id;
    await stop(runtime.child); runtime = await launch();
    const resumedHistory = await api<OpenMessage[]>(`/session/${resumable}/message`).catch(() => []);
    const resumedReceiptCount = resumedHistory.flatMap((message) => message.parts ?? []).filter((part) => Boolean(extractReceipt(part.state?.output ?? part.state?.error))).length;
    const cancelSession = await api<OpenSession>("/session", {});
    const beforeWait = allHostEvidence().length;
    try { await api<unknown>(`/session/${cancelSession.id}/prompt_async`, { agent: "profile_b", model: { providerID: "opencode", modelID: "big-pickle" }, parts: [{ type: "text", text: "Call aw_b_receipt_wait exactly once. Do not call any other tool." }] }); } catch { /* Recorded below. */ }
    const waitDeadline = Date.now() + 30000; let entered: Extract<HostEvidence, { type: "host.invocation.entered" }> | undefined;
    while (!entered && Date.now() < waitDeadline) { entered = allHostEvidence().slice(beforeWait).find((event): event is Extract<HostEvidence, { type: "host.invocation.entered" }> => event.type === "host.invocation.entered" && event.mode === "wait"); await pause(50); }
    let providerAbortAccepted = true; try { await api<unknown>(`/session/${cancelSession.id}/abort`, {}); } catch { providerAbortAccepted = false; }
    const sideChannel = entered ? hosts[1].cancel(entered.invocationId, generation) : "not_active";
    const cancelDeadline = Date.now() + 3000; while (entered && !allHostEvidence().some((event) => event.type === "host.invocation.outcome" && event.invocationId === entered?.invocationId) && Date.now() < cancelDeadline) await pause(25);
    const cancelledOutcome = entered ? allHostEvidence().find((event) => event.type === "host.invocation.outcome" && event.invocationId === entered?.invocationId) : undefined;
    await stop(runtime.child);
    return { concurrentReceipts: a.receiptCount + b.receiptCount, distinctConcurrentSessions: a.receiptCount > 0 && b.receiptCount > 0 ? 2 : 0, switchedReceiptCount: switched.receiptCount, retryDistinctReceipt, errorReceipts: errorRuns.map((run) => ({ mode: run.tool.replace("receipt_", ""), receiptCount: run.receiptCount, toolPartCount: run.toolPartCount })), resumedReceiptCount, cancellation: { entered: Boolean(entered), providerAbortAccepted, sideChannel, hostOutcome: cancelledOutcome?.type === "host.invocation.outcome" ? cancelledOutcome.outcome : "unknown", providerReceipt: false } };
  }

  async function codexProbe() {
    const ns = await namespace("codex");
    if (process.argv.includes("--existing-auth")) { try { const source = join(homedir(), ".codex", "auth.json"); await access(source); await symlink(source, join(ns.base, "codex", "auth.json")); } catch { return { status: "auth_unavailable" }; } }
    const child = start("codex", ["app-server"], ns.cwd, ns.env); if (!child.stdin || !child.stdout) throw new Error("pipes");
    let id = 0; const pending = new Map<number, (message: Rpc) => void>(); const events: Rpc[] = [];
    createInterface({ input: child.stdout }).on("line", (line) => { try { const message = JSON.parse(line) as Rpc; if (typeof message.id === "number" && pending.has(message.id)) { pending.get(message.id)?.(message); pending.delete(message.id); } else if (message.method) events.push(message); } catch { /* discard */ } });
    const call = async <T>(method: string, params: unknown, timeout = 30000): Promise<T> => { const requestId = ++id; const result = new Promise<Rpc>((resolve) => pending.set(requestId, resolve)); child.stdin?.write(`${JSON.stringify({ id: requestId, method, params })}\n`); const response = await Promise.race([result, pause(timeout).then(() => ({ error: true } as Rpc))]); if (response.error) throw new Error("rpc"); return response.result as T; };
    try {
      await call("initialize", { clientInfo: { name: "receipt_bridge_probe", version: "1" }, capabilities: { experimentalApi: true } });
      const lease = leases[0]; const thread = await call<{ thread: { id: string } }>("thread/start", { cwd: ns.cwd, approvalPolicy: "never", sandbox: "read-only", config: { mcp_servers: { [lease.server]: { url: `http://127.0.0.1:${lease.port}/mcp`, http_headers: { Authorization: `Bearer ${lease.token}` } } } } });
      const beginHost = allHostEvidence().length; const beginEvents = events.length;
      const turn = await call<{ turn?: { id?: string } }>("turn/start", { threadId: thread.thread.id, input: [{ type: "text", text: "Call mcp__aw_a__receipt_success exactly once. Do not call any other tool.", text_elements: [] }] });
      const deadline = Date.now() + 30000; let hostOutcome: Extract<HostEvidence, { type: "host.invocation.outcome" }> | undefined;
      while (!hostOutcome && Date.now() < deadline) { hostOutcome = allHostEvidence().slice(beginHost).find((event): event is Extract<HostEvidence, { type: "host.invocation.outcome" }> => event.type === "host.invocation.outcome"); await pause(50); }
      await pause(1000);
      const targetItems = events.slice(beginEvents).flatMap((event) => { const item = event.params?.item; return item && typeof item === "object" && JSON.stringify(item).includes("receipt_success") ? [item as Record<string, unknown>] : []; });
      const completed = targetItems.find((item) => item.status === "completed"); const providerReceipt = extractReceipt(completed?.result ?? completed?.error);
      if (providerReceipt) providerEvidence.push({ provider: "codex", session: "A", expectedLease: "A", runtimeGeneration: generation, invocationId: providerReceipt, server: "aw_a_receipt_success", eventIdentity: "codex-event-1" });
      if (!completed && turn.turn?.id) await call("turn/interrupt", { threadId: thread.thread.id, turnId: turn.turn.id }).catch(() => undefined);
      return { hostEntered: allHostEvidence().slice(beginHost).some((event) => event.type === "host.invocation.entered"), hostOutcome: hostOutcome?.outcome ?? "unknown", providerItemStarted: targetItems.some((item) => item.status === "inProgress"), providerItemCompleted: Boolean(completed), providerReceipt: Boolean(providerReceipt), status: providerReceipt ? "qualified_success" : "unqualified_stalled_item" };
    } catch { return { status: "provider_blocked" }; } finally { await stop(child); }
  }

  try {
    const versions = { codex: execFileSync("codex", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(), opencode: execFileSync("opencode", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() };
    observations.opencode = await openCodeProbe();
    observations.codex = await codexProbe();
    const direct = await fetch(`http://127.0.0.1:${leases[0].port}/mcp`, { method: "POST", headers: { Authorization: `Bearer ${leases[0].token}`, "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "receipt_success", arguments: {} } }) }).then((response) => response.json()) as unknown;
    const directReceipt = extractReceipt(direct);
    const baseCorrelation = correlate({ host: allHostEvidence(), provider: providerEvidence, activeRuntimeGeneration: generation });
    const first = providerEvidence[0];
    const duplicate = first ? correlate({ host: allHostEvidence(), provider: [...providerEvidence, { ...first }], activeRuntimeGeneration: generation }) : baseCorrelation;
    const stale = first ? correlate({ host: allHostEvidence(), provider: [...providerEvidence, { ...first, eventIdentity: "stale-event", runtimeGeneration: "stale" }], activeRuntimeGeneration: generation }) : baseCorrelation;
    const conflict = first ? correlate({ host: allHostEvidence(), provider: [...providerEvidence, { ...first, eventIdentity: "conflict-event", session: "conflicting-session" }], activeRuntimeGeneration: generation }) : baseCorrelation;
    const output = { kind: "capability-receipt-bridge-probe", versions, observations: { ...observations, host: { entered: allHostEvidence().filter((event) => event.type === "host.invocation.entered").length, outcomes: Object.fromEntries(["success", "reported_error", "thrown", "timeout", "cancelled"].map((outcome) => [outcome, allHostEvidence().filter((event) => event.type === "host.invocation.outcome" && event.outcome === outcome).length])) }, correlation: { exactPairs: baseCorrelation.pairs.length, unknownSession: baseCorrelation.unknownSession, profileMismatchPairs: baseCorrelation.pairs.filter((pair) => pair.leaseMismatch).length, duplicateEventsDeduplicated: duplicate.duplicateEventsDeduplicated, staleEventsRejected: stale.staleRejected, conflictsQuarantined: conflict.conflicts, directCredentialReceiptUnpaired: Boolean(directReceipt) && !providerEvidence.some((event) => event.invocationId === directReceipt) } }, privacy: { prompts: false, outputs: false, credentials: false, paths: false, sessionIds: false } };
    console.log(JSON.stringify(output, null, 2));
  } finally { for (const child of children) await stop(child); await Promise.all(hosts.map((host) => host.close())); await rm(root, { recursive: true, force: true }); }
}
