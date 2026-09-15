import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { correlate, type HostEvidence, type ProviderEvidence } from "../prototype-capability-receipt-bridge/bridge";
import { createStatefulReceiptHost } from "./stateful-host";

type Rpc = { id?: number | string; method?: string; result?: unknown; error?: unknown; params?: Record<string, unknown> };
type ThreadStart = { thread: { id: string } };
type TurnStart = { turn?: { id?: string } };
type ToolItem = Record<string, unknown> & { type: "mcpToolCall"; server: string; tool: string };
type Lease = { lease: "A" | "B"; server: string; token: string; port: number; host: ReturnType<typeof createStatefulReceiptHost> };

const pause = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const receiptPattern = /AW_RECEIPT:([0-9a-f-]+):(success|reported_error|thrown|timeout|cancelled)/i;

function receipt(value: unknown) { return (JSON.stringify(value) ?? "").match(receiptPattern)?.[1]; }
function hasReceipt(value: unknown) { return Boolean(receipt(value)); }
function isToolItem(value: unknown): value is ToolItem { return typeof value === "object" && value !== null && (value as Record<string, unknown>).type === "mcpToolCall"; }

async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGTERM");
  await Promise.race([exited, pause(1500)]);
  if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; }
}

function createClient(cwd: string, env: NodeJS.ProcessEnv, children: Set<ChildProcess>) {
  const child = spawn("codex", ["app-server"], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
  children.add(child);
  child.stderr?.resume();
  child.once("exit", () => children.delete(child));
  if (!child.stdin || !child.stdout) throw new Error("codex_pipes_unavailable");
  let id = 0;
  const pending = new Map<number, (message: Rpc) => void>();
  const events: Rpc[] = [];
  createInterface({ input: child.stdout }).on("line", (line) => {
    try {
      const message = JSON.parse(line) as Rpc;
      if (typeof message.id === "number" && !message.method && pending.has(message.id)) { pending.get(message.id)?.(message); pending.delete(message.id); }
      else if (message.method) {
        events.push(message);
        if (message.id !== undefined && message.method.endsWith("/requestApproval")) child.stdin?.write(`${JSON.stringify({ id: message.id, result: { decision: "accept" } })}\n`);
      }
    } catch { /* Ignore non-protocol output. */ }
  });
  const call = async <T>(method: string, params: unknown, timeoutMs = 30_000): Promise<T> => {
    const requestId = ++id;
    const response = new Promise<Rpc>((resolve) => pending.set(requestId, resolve));
    child.stdin?.write(`${JSON.stringify({ id: requestId, method, params })}\n`);
    const settled = await Promise.race([response, pause(timeoutMs).then(() => ({ error: "timeout" } as Rpc))]);
    if (settled.error) throw new Error("codex_rpc_failed");
    return settled.result as T;
  };
  return { child, events, call };
}

async function initialize(client: ReturnType<typeof createClient>) {
  await client.call("initialize", { clientInfo: { name: "codex_receipt_matrix", version: "1" }, capabilities: { experimentalApi: true } });
}

async function waitForItem(events: Rpc[], start: number, server: string, tool: string, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const item = events.slice(start).filter((event) => event.method === "item/completed").map((event) => event.params?.item).find((candidate): candidate is ToolItem => isToolItem(candidate) && candidate.server === server && candidate.tool === tool);
    if (item) return item;
    await pause(50);
  }
  return undefined;
}

async function waitForTurn(events: Rpc[], start: number, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (events.slice(start).some((event) => event.method === "turn/completed")) return true;
    await pause(50);
  }
  return false;
}

async function directCall(lease: Lease) {
  const headers = { Authorization: `Bearer ${lease.token}`, Accept: "application/json, text/event-stream", "Content-Type": "application/json" };
  const post = (body: unknown, sessionId?: string) => fetch(`http://127.0.0.1:${lease.port}/mcp`, { method: "POST", headers: { ...headers, ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}) }, body: JSON.stringify(body) });
  const initialized = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "direct", version: "1" } } });
  const sessionId = initialized.headers.get("mcp-session-id");
  await initialized.text();
  if (!sessionId) return false;
  await (await post({ jsonrpc: "2.0", method: "notifications/initialized" }, sessionId)).text();
  const response = await post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "receipt_success", arguments: {} } }, sessionId);
  return Boolean(receipt(await response.text()));
}

export async function main() {
  const root = await mkdtemp(join(tmpdir(), "aw-codex-receipt-matrix-"));
  const children = new Set<ChildProcess>();
  const generation = "codex-receipt-generation";
  const paired = (["A", "B"] as const).map((lease) => ({ lease, token: randomBytes(32).toString("hex") }));
  const activeHosts = paired.map((entry) => createStatefulReceiptHost({ token: entry.token, stateful: true, jsonResponse: false, timeoutMs: 700 }));
  const activePorts = await Promise.all(activeHosts.map((host) => host.start()));
  const activeLeases: Lease[] = paired.map((entry, index) => ({ ...entry, server: `receipt_${entry.lease.toLowerCase()}`, port: activePorts[index], host: activeHosts[index] }));

  const base = join(root, "runtime");
  const codexHome = join(base, "codex");
  const cwd = join(base, "work");
  await mkdir(codexHome, { recursive: true, mode: 0o700 });
  await mkdir(cwd, { recursive: true, mode: 0o700 });
  if (process.argv.includes("--existing-auth")) {
    const source = join(homedir(), ".codex", "auth.json");
    await access(source);
    await symlink(source, join(codexHome, "auth.json"));
  }
  const env = { PATH: process.env.PATH, HOME: join(base, "home"), CODEX_HOME: codexHome, TMPDIR: root } as NodeJS.ProcessEnv;
  let client = createClient(cwd, env, children);
  const providerEvidence: ProviderEvidence[] = [];
  let providerEvent = 0;

  const configFor = (lease: Lease) => ({ mcp_servers: { [lease.server]: { url: `http://127.0.0.1:${lease.port}/mcp`, http_headers: { Authorization: `Bearer ${lease.token}` }, default_tools_approval_mode: "approve" } } });
  const invoke = async (session: "A" | "B", expectedLease: "A" | "B", lease: Lease, tool: string, threadId?: string) => {
    const thread = threadId ?? (await client.call<ThreadStart>("thread/start", { cwd, approvalPolicy: "never", sandbox: "read-only", config: configFor(lease) })).thread.id;
    const start = client.events.length;
    const turn = await client.call<TurnStart>("turn/start", { threadId: thread, input: [{ type: "text", text: `Call mcp__${lease.server}__${tool} exactly once and then stop. Do not call any other tool.`, text_elements: [] }] });
    const item = await waitForItem(client.events, start, lease.server, tool);
    const invocationId = receipt(item);
    if (invocationId) providerEvidence.push({ provider: "codex", session, expectedLease, runtimeGeneration: generation, invocationId, server: `aw_${lease.lease.toLowerCase()}_${tool}`, eventIdentity: `codex-event-${++providerEvent}` });
    const turnTerminal = await waitForTurn(client.events, start, 30_000);
    if (!turnTerminal && turn.turn?.id) await client.call("turn/interrupt", { threadId: thread, turnId: turn.turn.id }).catch(() => undefined);
    return { threadId: thread, invocationId, terminal: Boolean(item), status: typeof item?.status === "string" ? item.status : "none", turnTerminal };
  };

  try {
    await initialize(client);
    const [a, b] = await Promise.all([invoke("A", "A", activeLeases[0], "receipt_success"), invoke("B", "B", activeLeases[1], "receipt_success")]);
    const switched = await invoke("B", "B", activeLeases[0], "receipt_success");
    const retry = await invoke("A", "A", activeLeases[0], "receipt_success", a.threadId);
    const errors = [];
    for (const tool of ["receipt_reported_error", "receipt_throw", "receipt_timeout"] as const) errors.push({ tool, result: await invoke("A", "A", activeLeases[0], tool) });

    const waitThread = await client.call<ThreadStart>("thread/start", { cwd, approvalPolicy: "never", sandbox: "read-only", config: configFor(activeLeases[1]) });
    const waitStart = client.events.length;
    const waitTurn = await client.call<TurnStart>("turn/start", { threadId: waitThread.thread.id, input: [{ type: "text", text: `Call mcp__${activeLeases[1].server}__receipt_wait exactly once and wait.`, text_elements: [] }] });
    const enterDeadline = Date.now() + 30_000;
    let enteredId: string | undefined;
    while (!enteredId && Date.now() < enterDeadline) {
      const entered = activeLeases[1].host.evidence.find((event) => event.type === "entered" && event.mode === "wait");
      enteredId = entered?.type === "entered" ? entered.invocationId : undefined;
      await pause(50);
    }
    const sideChannel = enteredId ? activeLeases[1].host.cancel(enteredId) : "not_active";
    const cancelItem = await waitForItem(client.events, waitStart, activeLeases[1].server, "receipt_wait", 10_000);
    const cancelTurnTerminal = await waitForTurn(client.events, waitStart, 10_000);
    if (!cancelTurnTerminal && waitTurn.turn?.id) await client.call("turn/interrupt", { threadId: waitThread.thread.id, turnId: waitTurn.turn.id }).catch(() => undefined);
    const cancelReceipt = receipt(cancelItem);
    if (cancelReceipt) providerEvidence.push({ provider: "codex", session: "B", expectedLease: "B", runtimeGeneration: generation, invocationId: cancelReceipt, server: "aw_b_receipt_wait", eventIdentity: `codex-event-${++providerEvent}` });

    const directReceipt = await directCall(activeLeases[0]);
    await stop(client.child);
    client = createClient(cwd, env, children);
    await initialize(client);
    const replay = await client.call("thread/read", { threadId: a.threadId, includeTurns: true }).catch(() => undefined);
    await client.call("thread/resume", { threadId: a.threadId, cwd, config: configFor(activeLeases[0]) });
    const resumed = await invoke("A", "A", activeLeases[0], "receipt_success", a.threadId);
    const resumedHistory = await client.call("thread/read", { threadId: a.threadId, includeTurns: true }).catch(() => undefined);

    const hostEvidence: HostEvidence[] = activeLeases.flatMap((lease) => lease.host.evidence.flatMap((event): HostEvidence[] => {
      if (event.type === "entered") return [{ type: "host.invocation.entered", invocationId: event.invocationId, runtimeGeneration: generation, lease: lease.lease, resourceId: "prototype.codex-receipt", mode: event.mode }];
      if (event.type === "outcome") return [{ type: "host.invocation.outcome", invocationId: event.invocationId, runtimeGeneration: generation, outcome: event.outcome }];
      return [];
    }));
    const baseCorrelation = correlate({ host: hostEvidence, provider: providerEvidence, activeRuntimeGeneration: generation });
    const first = providerEvidence[0];
    const replayed = first ? correlate({ host: hostEvidence, provider: [...providerEvidence, { ...first }], activeRuntimeGeneration: generation }) : baseCorrelation;
    const stale = first ? correlate({ host: hostEvidence, provider: [...providerEvidence, { ...first, eventIdentity: "stale", runtimeGeneration: "stale" }], activeRuntimeGeneration: generation }) : baseCorrelation;
    const conflict = first ? correlate({ host: hostEvidence, provider: [...providerEvidence, { ...first, eventIdentity: "conflict", session: "conflict" }], activeRuntimeGeneration: generation }) : baseCorrelation;
    const outcomeById = new Map(hostEvidence.filter((event): event is Extract<HostEvidence, { type: "host.invocation.outcome" }> => event.type === "host.invocation.outcome").map((event) => [event.invocationId, event.outcome]));

    console.log(JSON.stringify({
      kind: "codex-terminal-capability-receipt-matrix",
      version: execFileSync("codex", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(),
      observations: {
        concurrent: { receipts: Number(Boolean(a.invocationId)) + Number(Boolean(b.invocationId)), distinctSessions: Boolean(a.invocationId && b.invocationId && a.invocationId !== b.invocationId) },
        profileSwitch: { receipt: Boolean(switched.invocationId) },
        retry: { receipt: Boolean(retry.invocationId), distinct: Boolean(a.invocationId && retry.invocationId && a.invocationId !== retry.invocationId) },
        errors: errors.map(({ tool, result }) => ({ mode: tool.replace("receipt_", ""), receipt: Boolean(result.invocationId), terminal: result.terminal, status: result.status, hostOutcome: result.invocationId ? outcomeById.get(result.invocationId) ?? "unknown" : "unknown" })),
        cancellation: { entered: Boolean(enteredId), sideChannel, providerTerminal: Boolean(cancelItem), providerReceipt: Boolean(cancelReceipt), hostOutcome: enteredId ? outcomeById.get(enteredId) ?? "unknown" : "unknown" },
        restartHistoryReceipt: hasReceipt(replay),
        resume: { receipt: Boolean(resumed.invocationId), retainedAfterResume: Boolean(resumed.invocationId && (JSON.stringify(resumedHistory) ?? "").includes(resumed.invocationId)) },
        directCredentialReceiptUnpaired: directReceipt,
        correlation: { exactPairs: baseCorrelation.pairs.length, unknownSession: baseCorrelation.unknownSession, profileMismatchPairs: baseCorrelation.pairs.filter((pair) => pair.leaseMismatch).length, duplicateEventsDeduplicated: replayed.duplicateEventsDeduplicated, staleEventsRejected: stale.staleRejected, conflictsQuarantined: conflict.conflicts },
      },
      privacy: { prompts: false, outputs: false, credentials: false, paths: false, sessionIds: false, receipts: false },
    }, null, 2));
  } finally {
    await stop(client.child);
    for (const child of children) await stop(child);
    await Promise.all(activeHosts.map((host) => host.close()));
    await rm(root, { recursive: true, force: true });
  }
}
