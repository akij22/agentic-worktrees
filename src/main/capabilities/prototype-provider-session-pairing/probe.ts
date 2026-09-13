// THROWAWAY #71: inert Capability + live provider pairing probe. Never emits prompts, model output, credentials, or private paths.
import { randomBytes, randomUUID } from "node:crypto";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { access, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { defineCapability, defineTool, type CapabilityDefinition } from "@agentic-worktrees/capability-sdk";
import { createCapabilityHostServer } from "../capability-host-server";

type Entry = { invocationId: string; lease: "A" | "B"; mode: string; outcome: string };
type ProviderReceipt = { provider: "codex" | "opencode"; session: "A" | "B"; server: string; invocationId: string; status: string };
type RpcMessage = { id?: number; method?: string; params?: { threadId?: string }; result?: unknown; error?: unknown };
type CodexThread = { thread: { id: string; turns?: Array<{ items?: CodexItem[] }> } };
type CodexItem = { type: string; server?: string; tool?: string; status?: string; result?: unknown; error?: unknown };
type OpenCodeSession = { id: string };
type OpenCodePart = { type: string; tool?: string; state?: { status?: string; output?: unknown } };
type OpenCodeMessage = { info?: { error?: unknown }; parts?: OpenCodePart[] };
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function main(): Promise<void> {
  const scratch = await mkdtemp(join(tmpdir(), "aw-provider-pairing-"));
  const entries: Entry[] = [];
  const children = new Set<ChildProcess>();
  const rootEnv = { PATH: process.env.PATH, TMPDIR: scratch };
  const stop = async (child: ChildProcess) => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const done = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    child.kill("SIGTERM");
    await Promise.race([done, pause(2000)]);
    if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await done; }
  };
  const start = (command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) => {
    const child = spawn(command, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    child.stderr?.resume(); children.add(child); child.once("exit", () => children.delete(child));
    return child;
  };
  const namespaces = new Map<string, { cwd: string; env: NodeJS.ProcessEnv }>();
  const namespace = async (provider: string) => {
    const base = join(scratch, provider);
    for (const name of ["home", "codex", "config", "data/opencode", "cache", "state", "work"]) await mkdir(join(base, name), { recursive: true, mode: 0o700 });
    const env = { ...rootEnv, HOME: join(base, "home"), CODEX_HOME: join(base, "codex"), XDG_CONFIG_HOME: join(base, "config"), XDG_DATA_HOME: join(base, "data"), XDG_CACHE_HOME: join(base, "cache"), XDG_STATE_HOME: join(base, "state") };
    if (process.argv.includes("--existing-auth")) {
      const authLinks = provider === "codex"
        ? [[join(homedir(), ".codex/auth.json"), join(base, "codex/auth.json")]]
        : [];
      for (const [source, target] of authLinks) {
        try { await access(source); await symlink(source, target); } catch { /* Missing auth is a sanitized provider-blocked result. */ }
      }
    }
    const result = { cwd: join(base, "work"), env };
    namespaces.set(provider, result);
    return result;
  };

  const leases = await Promise.all((["A", "B"] as const).map(async (lease) => {
    const token = randomBytes(32).toString("hex");
    const capability = defineCapability({
      manifest: { id: "prototype.session-pairing", name: "Pairing probe", version: "0.1.0", sdkVersion: "^0.1.0", description: "Inert pairing probe", category: "test", author: { name: "Prototype" }, license: "MIT", compatibility: { codex: "supported", opencode: "supported" }, permissions: { network: [], secrets: [] }, settings: {} },
      tools: [defineTool<{ mode?: "ok" | "fail" | "throw" | "wait" }>({
        name: "receipt_probe", description: "Call exactly once with the requested mode for the inert receipt test.",
        inputSchema: { type: "object", properties: { mode: { type: "string", enum: ["ok", "fail", "throw", "wait"] } }, additionalProperties: true },
        execute: async ({ mode = "ok" }, context) => {
          const entry: Entry = { invocationId: randomUUID(), lease, mode, outcome: "entered" };
          entries.push(entry);
          if (mode === "throw") { entry.outcome = "thrown"; throw new Error("synthetic post-entry failure"); }
          if (mode === "wait") await new Promise<void>((resolve) => {
            const timer = setTimeout(() => { entry.outcome = "completed-without-provider-cancel"; resolve(); }, 12000);
            context.signal.addEventListener("abort", () => { clearTimeout(timer); entry.outcome = "aborted"; resolve(); }, { once: true });
          });
          else entry.outcome = mode === "fail" ? "reported-error" : "success";
          return { isError: mode === "fail", content: [{ type: "text", text: `AW_RECEIPT:${entry.invocationId}` }] };
        },
      })],
    });
    const host = createCapabilityHostServer({ token, executionTimeoutMs: 15000, resolveSecret: async () => undefined, registry: async () => capability as CapabilityDefinition });
    await host.setActiveCapabilities([{ kind: "bundled", capabilityId: "prototype.session-pairing", version: "0.1.0" }]);
    return { lease, token, host, port: await host.start(), server: `aw_${lease.toLowerCase()}` };
  }));
  const [leaseA, leaseB] = leases;
  const receiptPattern = /AW_RECEIPT:([0-9a-f-]{36})/;
  const extractReceipt = (value: unknown) => JSON.stringify(value).match(receiptPattern)?.[1];
  const results: Record<string, unknown> = { kind: "provider-session-pairing-probe", versions: {}, observations: {}, privacy: { prompts: false, outputs: false, credentials: false, paths: false, sessionIds: false } };

  async function directCall(lease = leaseA) {
    const response = await fetch(`http://127.0.0.1:${lease.port}/mcp`, { method: "POST", headers: { Authorization: `Bearer ${lease.token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "receipt_probe", arguments: { mode: "ok" } } }) });
    return extractReceipt(await response.text());
  }

  async function codexProbe() {
    let stage = "namespace";
    const ns = await namespace("codex");
    const child = start("codex", ["app-server"], ns.cwd, ns.env);
    if (!child.stdout || !child.stdin) throw new Error("codex-pipes-unavailable");
    let id = 0; const pending = new Map<number, (message: RpcMessage) => void>(); const events: RpcMessage[] = [];
    createInterface({ input: child.stdout }).on("line", (line) => { try { const message = JSON.parse(line) as RpcMessage; if (typeof message.id === "number") { const resolve = pending.get(message.id); if (resolve) { resolve(message); pending.delete(message.id); } } else if (message.method) events.push(message); } catch { /* Ignore nonprotocol output. */ } });
    const input = child.stdin;
    const call = async <T>(method: string, params: unknown): Promise<T> => { const requestId = ++id; const answer = new Promise<RpcMessage>((resolve) => pending.set(requestId, resolve)); input.write(`${JSON.stringify({ id: requestId, method, params })}\n`); const message = await Promise.race([answer, pause(30000).then((): RpcMessage => ({ error: true }))]); if (message.error) throw new Error("codex-protocol-failure"); return message.result as T; };
    const config = (lease: typeof leaseA) => ({ mcp_servers: { [lease.server]: { url: `http://127.0.0.1:${lease.port}/mcp`, http_headers: { Authorization: `Bearer ${lease.token}` } } } });
    const waitTurn = async (threadId: string, begin: number) => { const end = Date.now() + 60000; while (!events.slice(begin).some((event) => event.method === "turn/completed" && event.params?.threadId === threadId) && Date.now() < end) await pause(100); };
    let observedToolItems = 0;
    let targetToolItems = 0;
    const targetStatuses: string[] = [];
    const targetErrorCategories: string[] = [];
    let verifiedServers = 0;
    const run = async (session: "A" | "B", lease: typeof leaseA, mode: string) => {
      const thread = await call<CodexThread>("thread/start", { cwd: ns.cwd, approvalPolicy: "never", sandbox: "read-only", config: config(lease) });
      const statusDeadline = Date.now() + 10000;
      while (Date.now() < statusDeadline) {
        const status = await call<unknown>("mcpServerStatus/list", { threadId: thread.thread.id, detail: "toolsAndAuthOnly", limit: 100 });
        const serialized = JSON.stringify(status);
        if (serialized.includes(lease.server) && serialized.includes("receipt_probe")) { verifiedServers += 1; break; }
        await pause(100);
      }
      const begin = events.length;
      await call<unknown>("turn/start", { threadId: thread.thread.id, input: [{ type: "text", text: `You must call the mcp__${lease.server}__receipt_probe tool exactly once with mode ${mode}. Do not answer without calling it and do not call any other tool.`, text_elements: [] }] });
      await waitTurn(thread.thread.id, begin);
      const history = await call<CodexThread>("thread/read", { threadId: thread.thread.id, includeTurns: true });
      const items = (history.thread.turns ?? []).flatMap((turn) => turn.items ?? []).filter((item) => item.type === "mcpToolCall");
      observedToolItems += items.length;
      const targets = items.filter((item) => item.server === lease.server && item.tool === "receipt_probe");
      targetToolItems += targets.length;
      targetStatuses.push(...targets.flatMap((item) => item.status ? [item.status] : []));
      targetErrorCategories.push(...targets.flatMap((item) => { const value = JSON.stringify(item.error ?? item.result); return value.includes("Invalid capability tool input") ? ["invalid-input"] : /401|unauthorized|auth/i.test(value) ? ["authentication"] : /connect|network|fetch|socket/i.test(value) ? ["connection"] : value ? ["unclassified-redacted"] : []; }));
      return items.flatMap((item): ProviderReceipt[] => { const invocationId = extractReceipt(item.result); return invocationId && item.server && item.status ? [{ provider: "codex", session, server: item.server, invocationId, status: item.status }] : []; });
    };
    try {
      stage = "initialize";
      await call<unknown>("initialize", { clientInfo: { name: "provider_pairing_probe", version: "1" }, capabilities: { experimentalApi: true } });
      stage = "concurrent-success";
      const [a, b] = await Promise.all([run("A", leaseA, "ok"), run("B", leaseB, "ok")]);
      stage = "profile-switch";
      const switched = await run("B", leaseA, "ok");
      stage = "reported-error";
      const failed = await run("A", leaseA, "fail");
      stage = "thrown-error";
      const thrownBefore = entries.length; await run("A", leaseA, "throw"); const thrown = entries.slice(thrownBefore);
      return { pairedReceipts: [...a, ...b].length, distinctSessions: new Set([...a, ...b].map((receipt) => receipt.session)).size, verifiedServers, observedToolItems, targetToolItems, targetStatuses: [...new Set(targetStatuses)], targetErrorCategories: [...new Set(targetErrorCategories)], switchedProfileReceiptSession: switched[0]?.session ?? "unpaired", switchedProfileServer: switched[0]?.server ?? "unpaired", isErrorReceiptCount: failed.length, thrownEntryCount: thrown.length, thrownProviderReceiptCount: 0, status: "observed" };
    } catch { return { status: "provider-blocked", stage }; } finally { await stop(child); }
  }

  async function openCodeProbe() {
    const ns = await namespace("opencode");
    const password = randomBytes(24).toString("hex");
    const mcp = Object.fromEntries(leases.map((lease) => [lease.server, { type: "remote", url: `http://127.0.0.1:${lease.port}/mcp`, headers: { Authorization: `Bearer ${lease.token}` } }]));
    const agent = Object.fromEntries(leases.map((lease) => [`profile_${lease.lease.toLowerCase()}`, { mode: "primary", permission: { "aw_*": "deny", [`${lease.server}_*`]: "allow" } }]));
    const env = { ...ns.env, OPENCODE_SERVER_USERNAME: "prototype", OPENCODE_SERVER_PASSWORD: password, OPENCODE_DISABLE_PROJECT_CONFIG: "true", OPENCODE_CONFIG_CONTENT: JSON.stringify({ mcp, agent, plugin: [] }) };
    const child = start("opencode", ["serve", "--hostname", "127.0.0.1", "--port", "0"], ns.cwd, env);
    if (!child.stdout) throw new Error("opencode-stdout-unavailable");
    let output = ""; let baseUrl: string | undefined; child.stdout.on("data", (chunk) => { output += chunk; baseUrl = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; });
    const end = Date.now() + 20000; while (!baseUrl && child.exitCode === null && Date.now() < end) await pause(50);
    if (!baseUrl) { await stop(child); return { status: "provider-blocked" }; }
    const api = async <T>(path: string, body?: unknown): Promise<T> => { const response = await fetch(`${baseUrl}${path}`, { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", "x-opencode-directory": ns.cwd, Authorization: `Basic ${Buffer.from(`prototype:${password}`).toString("base64")}` }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000) }); if (!response.ok) throw new Error("opencode-api-failure"); const text = await response.text(); return (text ? JSON.parse(text) : undefined) as T; };
    const mcpStatus = await api<Record<string, unknown>>("/mcp").catch(() => ({}));
    const serializedMcpStatus = JSON.stringify(mcpStatus);
    const configuredServerCount = leases.filter((lease) => serializedMcpStatus.includes(lease.server)).length;
    const connectedServerCount = leases.filter((lease) => serializedMcpStatus.includes(lease.server) && serializedMcpStatus.includes("connected")).length;
    const run = async (session: "A" | "B", lease: typeof leaseA, mode: string, profileLease = lease) => {
      const created = await api<OpenCodeSession>("/session", {});
      let submissionFailed = false;
      try { await api<unknown>(`/session/${created.id}/message`, { agent: `profile_${profileLease.lease.toLowerCase()}`, model: { providerID: "opencode", modelID: "big-pickle" }, parts: [{ type: "text", text: `Call the ${profileLease.server}_receipt_probe tool exactly once with mode ${mode}. Do not call any other tool.` }] }); }
      catch { submissionFailed = true; }
      const history = await api<OpenCodeMessage[]>(`/session/${created.id}/message`);
      const parts = history.flatMap((message) => message.parts ?? []);
      const receipts = parts.filter((part) => part.type === "tool").flatMap((part): ProviderReceipt[] => { const invocationId = extractReceipt(part.state?.output); return invocationId && part.tool && part.state?.status ? [{ provider: "opencode", session, server: part.tool, invocationId, status: part.state.status }] : []; });
      const errors = history.flatMap((message) => message.info?.error ? [JSON.stringify(message.info.error)] : []);
      const errorCategories = [...new Set(errors.map((error) => /auth|credential|api.key|unauthorized/i.test(error) ? "authentication" : /model.*not|not.*model/i.test(error) ? "model-unavailable" : /fetch|connect|network|socket|mcp/i.test(error) ? "connection-or-mcp" : "unclassified-redacted"))];
      return { receipts, submissionFailed, toolPartCount: parts.filter((part) => part.type === "tool").length, assistantErrorCount: errors.length, errorCategories };
    };
    try {
      const [a, b] = await Promise.all([run("A", leaseA, "ok"), run("B", leaseB, "ok")]);
      let switchedReceipts: ProviderReceipt[] = [];
      let switchedBlocked = false;
      try { switchedReceipts = (await run("B", leaseB, "ok", leaseA)).receipts; } catch { switchedBlocked = true; }
      let failedReceipts: ProviderReceipt[] = [];
      let reportedErrorBlocked = false;
      try { failedReceipts = (await run("A", leaseA, "fail")).receipts; } catch { reportedErrorBlocked = true; }
      const thrownBefore = entries.length;
      try { await run("A", leaseA, "throw"); } catch { /* A thrown host failure can terminate the provider request before a receipt is persisted. */ }
      const thrown = entries.slice(thrownBefore);
      const cancellationSession = await api<OpenCodeSession>("/session", {});
      const cancellationEntryStart = entries.length;
      let cancellationSubmitted = true;
      try { await api<unknown>(`/session/${cancellationSession.id}/prompt_async`, { agent: "profile_b", model: { providerID: "opencode", modelID: "big-pickle" }, parts: [{ type: "text", text: "You must call the aw_b_receipt_probe tool exactly once with mode wait. Do not call any other tool." }] }); }
      catch { cancellationSubmitted = false; }
      const cancellationDeadline = Date.now() + 30000;
      while (!entries.slice(cancellationEntryStart).some((entry) => entry.mode === "wait") && Date.now() < cancellationDeadline) await pause(100);
      const waitingEntry = entries.slice(cancellationEntryStart).find((entry) => entry.mode === "wait");
      let abortAccepted = true;
      try { await api<unknown>(`/session/${cancellationSession.id}/abort`, {}); } catch { abortAccepted = false; }
      await pause(500);
      const concurrentReceipts = [...a.receipts, ...b.receipts];
      return { configuredServerCount, connectedServerCount, pairedReceipts: concurrentReceipts.length, distinctSessions: new Set(concurrentReceipts.map((receipt) => receipt.session)).size, concurrentToolPartCount: a.toolPartCount + b.toolPartCount, concurrentAssistantErrorCount: a.assistantErrorCount + b.assistantErrorCount, concurrentErrorCategories: [...new Set([...a.errorCategories, ...b.errorCategories])], switchedProfileReceiptSession: switchedReceipts[0]?.session ?? "unpaired", switchedProfileServer: switchedReceipts[0]?.server ?? "unpaired", switchedBlocked, isErrorReceiptCount: failedReceipts.length, reportedErrorBlocked, thrownEntryCount: thrown.length, thrownProviderReceiptCount: 0, cancellationSubmitted, cancellationEntered: Boolean(waitingEntry), abortAccepted, cancellationHandlerOutcome: waitingEntry?.outcome ?? "not-entered", cancellationProviderReceipt: false, status: "observed" };
    } catch { return { status: "provider-blocked" }; } finally { await stop(child); }
  }

  try {
    (results.versions as Record<string, string>).codex = execFileSync("codex", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    (results.versions as Record<string, string>).opencode = execFileSync("opencode", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    (results.observations as Record<string, unknown>).codex = await codexProbe();
    (results.observations as Record<string, unknown>).opencode = await openCodeProbe();
    const directReceipt = await directCall();
    (results.observations as Record<string, unknown>).directCredentialReuse = { hostEntry: Boolean(directReceipt), providerReceipt: false, sessionAttribution: "unknown" };
    (results.observations as Record<string, unknown>).hostLedger = { entered: entries.length, successes: entries.filter((entry) => entry.outcome === "success").length, reportedErrors: entries.filter((entry) => entry.outcome === "reported-error").length, thrown: entries.filter((entry) => entry.outcome === "thrown").length, aborted: entries.filter((entry) => entry.outcome === "aborted").length };
    (results.observations as Record<string, unknown>).currentBoundary = { successfulAndReportedErrorPairing: "requires-echoed-host-receipt", thrownAndTimeoutPairing: "unavailable-current-host", cancellationRouting: "unproven-current-stateless-host" };
    console.log(JSON.stringify(results, null, 2));
  } finally {
    await Promise.all([...children].map(stop));
    await Promise.all(leases.map((lease) => lease.host.close()));
    await rm(scratch, { recursive: true, force: true });
  }
}
