import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
// eslint-disable-next-line import/no-unresolved -- MCP SDK ESM subpaths are not resolved by the ESLint TypeScript resolver.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
// eslint-disable-next-line import/no-unresolved -- MCP SDK ESM subpaths are not resolved by the ESLint TypeScript resolver.
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
/* eslint-disable import/no-unresolved -- MCP SDK ESM subpaths are not resolved by the ESLint TypeScript resolver. */
import { CallToolRequestSchema, isInitializeRequest, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
/* eslint-enable import/no-unresolved */

export type TerminalProbeEvidence =
  | { type: "request"; method: string; hadSession: boolean }
  | { type: "entered"; invocationId: string; mode: TerminalProbeMode }
  | { type: "outcome"; invocationId: string; outcome: TerminalProbeOutcome };

export type TerminalProbeMode = "success" | "reported_error" | "throw" | "timeout" | "wait";
export type TerminalProbeOutcome = "success" | "reported_error" | "thrown" | "timeout" | "cancelled";

type Session = { mcp: Server; transport: StreamableHTTPServerTransport };
type ActiveInvocation = { controller: AbortController };

const tools = new Map<string, TerminalProbeMode>([
  ["receipt_success", "success"],
  ["receipt_reported_error", "reported_error"],
  ["receipt_throw", "throw"],
  ["receipt_timeout", "timeout"],
  ["receipt_wait", "wait"],
]);

function authorized(actual: string | undefined, token: string) {
  if (!actual?.startsWith("Bearer ")) return false;
  const left = Buffer.from(actual.slice(7));
  const right = Buffer.from(token);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("invalid_json_body");
  }
}

function json(response: ServerResponse, status: number, value?: unknown) {
  const payload = value === undefined ? "" : JSON.stringify(value);
  response.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) });
  response.end(payload);
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<"elapsed" | "aborted"> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve("elapsed"), milliseconds);
    signal?.addEventListener("abort", () => { clearTimeout(timer); resolve("aborted"); }, { once: true });
  });
}

function envelope(invocationId: string, outcome: TerminalProbeOutcome) {
  return `AW_RECEIPT:${invocationId}:${outcome}`;
}

export function createStatefulReceiptHost(input: { token: string; stateful: boolean; jsonResponse: boolean; timeoutMs?: number }) {
  const evidence: TerminalProbeEvidence[] = [];
  const sessions = new Map<string, Session>();
  const active = new Map<string, ActiveInvocation>();
  const terminal = new Set<string>();

  const execute = async (mode: TerminalProbeMode, providerSignal: AbortSignal) => {
    const invocationId = randomUUID();
    const controller = new AbortController();
    const abortFromProvider = () => controller.abort();
    providerSignal.addEventListener("abort", abortFromProvider, { once: true });
    active.set(invocationId, { controller });
    evidence.push({ type: "entered", invocationId, mode });
    let outcome: TerminalProbeOutcome;
    try {
      if (mode === "throw") throw new Error("synthetic");
      if (mode === "reported_error") outcome = "reported_error";
      else if (mode === "wait") {
        outcome = await delay(60_000, controller.signal) === "aborted" ? "cancelled" : "timeout";
      } else {
        const timeoutMs = input.timeoutMs ?? 500;
        const duration = mode === "success" ? 1 : timeoutMs * 4;
        const result = await Promise.race([delay(duration, controller.signal), delay(timeoutMs).then(() => "deadline" as const)]);
        if (result === "aborted") outcome = "cancelled";
        else if (result === "deadline") { controller.abort(); outcome = "timeout"; }
        else outcome = "success";
      }
    } catch {
      outcome = "thrown";
    } finally {
      providerSignal.removeEventListener("abort", abortFromProvider);
      active.delete(invocationId);
      terminal.add(invocationId);
    }
    evidence.push({ type: "outcome", invocationId, outcome });
    return { isError: outcome !== "success", content: [{ type: "text" as const, text: envelope(invocationId, outcome) }] };
  };

  const createSession = async () => {
    const mcp = new Server({ name: "codex-terminal-receipt-probe", version: "1" }, { capabilities: { tools: {} } });
    mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [...tools].map(([name]) => ({ name, description: `Return an inert ${name} receipt.`, inputSchema: { type: "object", properties: {}, additionalProperties: false } })),
    }));
    mcp.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const mode = tools.get(request.params.name);
      if (!mode) return { isError: true, content: [{ type: "text" as const, text: "unknown_tool" }] };
      return execute(mode, extra.signal);
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: input.stateful ? randomUUID : undefined,
      enableJsonResponse: input.jsonResponse,
      onsessioninitialized: input.stateful ? (sessionId) => { sessions.set(sessionId, { mcp, transport }); } : undefined,
    });
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };
    await mcp.connect(transport);
    return { mcp, transport };
  };

  const server = createServer(async (request, response) => {
    if (request.url !== "/mcp") { json(response, 404, { error: "not_found" }); return; }
    if (!authorized(request.headers.authorization, input.token)) { json(response, 401, { error: "unauthorized" }); return; }
    if (request.method === "GET" || request.method === "DELETE") {
      if (!input.stateful) { response.writeHead(405, { Allow: "POST" }).end(); return; }
      const sessionId = request.headers["mcp-session-id"];
      const session = typeof sessionId === "string" ? sessions.get(sessionId) : undefined;
      if (!session) { json(response, 400, { error: "invalid_session" }); return; }
      await session.transport.handleRequest(request, response);
      return;
    }
    if (request.method !== "POST") { response.writeHead(405, { Allow: "GET, POST, DELETE" }).end(); return; }
    let parsed: unknown;
    try { parsed = await readBody(request); } catch { json(response, 400, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "invalid_request" } }); return; }
    const sessionId = request.headers["mcp-session-id"];
    evidence.push({ type: "request", method: typeof parsed === "object" && parsed !== null && "method" in parsed ? String(parsed.method) : "unknown", hadSession: typeof sessionId === "string" });
    if (!input.stateful) {
      const created = await createSession();
      try { await created.transport.handleRequest(request, response, parsed); }
      finally { await created.transport.close(); await created.mcp.close(); }
      return;
    }
    const existing = typeof sessionId === "string" ? sessions.get(sessionId) : undefined;
    if (existing) { await existing.transport.handleRequest(request, response, parsed); return; }
    if (!sessionId && isInitializeRequest(parsed)) {
      const created = await createSession();
      await created.transport.handleRequest(request, response, parsed);
      return;
    }
    json(response, 400, { jsonrpc: "2.0", id: null, error: { code: -32000, message: "invalid_session" } });
  });

  return {
    evidence,
    start: () => new Promise<number>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") reject(new Error("bind_failed"));
        else resolve(address.port);
      });
    }),
    cancel(invocationId: string) {
      const invocation = active.get(invocationId);
      if (!invocation) return terminal.has(invocationId) ? "already_terminal" as const : "not_active" as const;
      invocation.controller.abort();
      return "cancel_requested" as const;
    },
    async close() {
      for (const session of sessions.values()) {
        await session.transport.close();
        await session.mcp.close();
      }
      sessions.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
