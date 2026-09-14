// THROWAWAY #73: typed receipt/cancellation boundary, intentionally independent of production services.
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export type ProbeMode = "success" | "reported_error" | "throw" | "timeout" | "wait";
export type HostOutcome = "success" | "reported_error" | "thrown" | "timeout" | "cancelled";
export type HostEvidence =
  | { type: "host.invocation.entered"; invocationId: string; runtimeGeneration: string; lease: "A" | "B"; resourceId: string; mode: ProbeMode }
  | { type: "host.invocation.outcome"; invocationId: string; runtimeGeneration: string; outcome: HostOutcome };
export type ProviderEvidence = { provider: "codex" | "opencode"; session: string; expectedLease: "A" | "B"; runtimeGeneration: string; invocationId: string; server: string; eventIdentity: string };

type ActiveInvocation = { runtimeGeneration: string; controller: AbortController };
type JsonRpcRequest = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: { name?: unknown } };

const receipt = (invocationId: string, outcome: HostOutcome) => `AW_RECEIPT:${invocationId};AW_OUTCOME:${outcome}`;
const body = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};
const json = (response: ServerResponse, status: number, value?: unknown) => {
  if (value === undefined) { response.writeHead(status).end(); return; }
  const serialized = JSON.stringify(value);
  response.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(serialized) }).end(serialized);
};
const delay = (ms: number, signal?: AbortSignal) => new Promise<"elapsed" | "aborted">((resolve) => {
  const timer = setTimeout(() => resolve("elapsed"), ms);
  signal?.addEventListener("abort", () => { clearTimeout(timer); resolve("aborted"); }, { once: true });
});

export function createReceiptBridgeHost(input: { lease: "A" | "B"; token: string; runtimeGeneration: string; timeoutMs?: number }) {
  const evidence: HostEvidence[] = [];
  const active = new Map<string, ActiveInvocation>();
  const toolModes = new Map<string, ProbeMode>([["receipt_success", "success"], ["receipt_reported_error", "reported_error"], ["receipt_throw", "throw"], ["receipt_timeout", "timeout"], ["receipt_wait", "wait"]]);
  const execute = async (mode: ProbeMode) => {
    const invocationId = randomUUID();
    const controller = new AbortController();
    active.set(invocationId, { runtimeGeneration: input.runtimeGeneration, controller });
    evidence.push({ type: "host.invocation.entered", invocationId, runtimeGeneration: input.runtimeGeneration, lease: input.lease, resourceId: "prototype.receipt-bridge", mode });
    let outcome: HostOutcome;
    try {
      if (mode === "throw") throw new Error("synthetic");
      if (mode === "reported_error") outcome = "reported_error";
      else {
        const duration = mode === "success" ? 1 : mode === "timeout" ? (input.timeoutMs ?? 250) * 4 : 60_000;
        const result = await Promise.race([delay(duration, controller.signal), delay(input.timeoutMs ?? 250).then(() => "deadline" as const)]);
        if (result === "aborted") outcome = "cancelled";
        else if (result === "deadline") { controller.abort(); outcome = "timeout"; }
        else outcome = "success";
      }
    } catch { outcome = "thrown"; }
    finally { active.delete(invocationId); }
    evidence.push({ type: "host.invocation.outcome", invocationId, runtimeGeneration: input.runtimeGeneration, outcome });
    return { isError: outcome !== "success", content: [{ type: "text", text: receipt(invocationId, outcome) }] };
  };
  const server = createServer(async (request, response) => {
    if (request.url !== "/mcp") { json(response, 404, { error: "not_found" }); return; }
    if (request.headers.authorization !== `Bearer ${input.token}`) { json(response, 401, { error: "unauthorized" }); return; }
    if (request.method !== "POST") { json(response, 405); return; }
    let message: JsonRpcRequest;
    try { message = await body(request) as JsonRpcRequest; } catch { json(response, 400, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "invalid_request" } }); return; }
    if (message.method === "notifications/initialized") { json(response, 202); return; }
    if (message.method === "initialize") { json(response, 200, { jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "receipt-bridge-prototype", version: "1" } } }); return; }
    if (message.method === "tools/list") { json(response, 200, { jsonrpc: "2.0", id: message.id, result: { tools: [...toolModes].map(([name]) => ({ name, description: `Inert ${name} receipt check.`, inputSchema: { type: "object", properties: {}, additionalProperties: false } })) } }); return; }
    if (message.method === "tools/call") {
      const mode = toolModes.get(String(message.params?.name ?? ""));
      if (!mode) { json(response, 200, { jsonrpc: "2.0", id: message.id, result: { isError: true, content: [{ type: "text", text: "unknown_tool" }] } }); return; }
      json(response, 200, { jsonrpc: "2.0", id: message.id, result: await execute(mode) }); return;
    }
    json(response, 200, { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "method_not_found" } });
  });
  return {
    evidence,
    start: () => new Promise<number>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => { const address = server.address(); if (!address || typeof address === "string") reject(new Error("bind_failed")); else resolve(address.port); }); }),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    cancel(invocationId: string, runtimeGeneration: string) {
      const invocation = active.get(invocationId);
      if (!invocation) return "not_active" as const;
      if (invocation.runtimeGeneration !== runtimeGeneration) return "stale_generation" as const;
      invocation.controller.abort();
      return "cancel_requested" as const;
    },
  };
}

export function correlate(input: { host: HostEvidence[]; provider: ProviderEvidence[]; activeRuntimeGeneration: string }) {
  const entered = new Map(input.host.filter((event): event is Extract<HostEvidence, { type: "host.invocation.entered" }> => event.type === "host.invocation.entered").map((event) => [event.invocationId, event]));
  const outcomes = new Map(input.host.filter((event): event is Extract<HostEvidence, { type: "host.invocation.outcome" }> => event.type === "host.invocation.outcome").map((event) => [event.invocationId, event]));
  const uniqueProvider = new Map<string, ProviderEvidence>();
  let staleRejected = 0;
  for (const event of input.provider) {
    if (event.runtimeGeneration !== input.activeRuntimeGeneration) { staleRejected++; continue; }
    uniqueProvider.set(event.eventIdentity, event);
  }
  const pairs = [];
  let unknownSession = 0;
  let conflicts = 0;
  for (const [invocationId, host] of entered) {
    const matching = [...uniqueProvider.values()].filter((event) => event.invocationId === invocationId);
    const sessions = new Set(matching.map((event) => event.session));
    if (sessions.size === 1 && matching.length >= 1 && host.runtimeGeneration === input.activeRuntimeGeneration) {
      const provider = matching[0];
      pairs.push({ invocationId, session: provider.session, outcome: outcomes.get(invocationId)?.outcome ?? "entered", leaseMismatch: provider.expectedLease !== host.lease || !provider.server.startsWith(`aw_${host.lease.toLowerCase()}_`) });
    } else { unknownSession++; if (sessions.size > 1) conflicts++; }
  }
  return { pairs, unknownSession, conflicts, staleRejected, duplicateEventsDeduplicated: input.provider.length - uniqueProvider.size - staleRejected };
}
