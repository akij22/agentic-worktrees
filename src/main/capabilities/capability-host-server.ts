import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import Ajv, { type ValidateFunction } from "ajv";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { CapabilityError, limitCapabilityOutput, type CapabilityDefinition, type CapabilityExecutionContext, type CapabilityTool } from "@agentic-worktrees/capability-sdk";
import { getHostedCapability } from "./host-registry";

export interface CapabilityHostServerOptions {
  token: string;
  port?: number;
  hostname?: "127.0.0.1" | "::1";
  resolveSecret(capabilityId: string, settingKey: string): Promise<string | undefined>;
  registry?: (id: string) => CapabilityDefinition | undefined;
}

export interface CapabilityHostServer {
  start(): Promise<number>;
  setActiveCapabilities(ids: readonly string[], settings?: Record<string, Record<string, unknown>>): Promise<string[]>;
  close(): Promise<void>;
}

interface ActiveTool { capability: CapabilityDefinition; tool: CapabilityTool<never>; validate: ValidateFunction }

function authorized(header: string | undefined, expected: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const actual = Buffer.from(header.slice(7));
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}
async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 1024 * 1024) throw new CapabilityError("invalid_input", "MCP request is too large.");
    chunks.push(bytes);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
  catch { throw new CapabilityError("invalid_input", "Invalid MCP request."); }
}
function safeError(error: unknown): CapabilityError {
  if (error instanceof CapabilityError) return error;
  if (error instanceof Error && error.name === "AbortError") return new CapabilityError("cancelled", "Capability execution was cancelled.");
  return new CapabilityError("internal_error", "Capability execution failed.");
}
function respondJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value));
}

export function createCapabilityHostServer(options: CapabilityHostServerOptions): CapabilityHostServer {
  if (options.hostname && options.hostname !== "127.0.0.1" && options.hostname !== "::1") {
    throw new CapabilityError("permission_denied", "Capability hosts must bind to loopback.");
  }
  const registry = options.registry ?? getHostedCapability;
  const validators = new Ajv({ strict: true, allErrors: true });
  const activeTools = new Map<string, ActiveTool>();
  let activeSettings: Record<string, Record<string, unknown>> = {};

  const nodeServer = createServer(async (request, response) => {
    if (request.url !== "/mcp") { respondJson(response, 404, { error: "Not found" }); return; }
    if (!authorized(request.headers.authorization, options.token)) { respondJson(response, 401, { error: "Unauthorized" }); return; }
    if (request.method !== "POST") { response.writeHead(405).end(); return; }
    let parsed: unknown;
    try { parsed = await body(request); }
    catch (error) { const safe = safeError(error); respondJson(response, 400, { jsonrpc: "2.0", id: null, error: { code: -32600, message: safe.message } }); return; }

    const mcp = new Server({ name: "agentic-worktrees", version: "0.1.0" }, { capabilities: { tools: { listChanged: true } } });
    mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...activeTools.values()].map(({ tool }) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })) }));
    mcp.setRequestHandler(CallToolRequestSchema, async (call, extra) => {
      const entry = activeTools.get(call.params.name);
      if (!entry) return { isError: true, content: [{ type: "text" as const, text: "Unknown or inactive capability tool." }] };
      if (!entry.validate(call.params.arguments ?? {})) return { isError: true, content: [{ type: "text" as const, text: "Invalid capability tool input." }] };
      const manifest = entry.capability.manifest;
      const context: CapabilityExecutionContext = {
        signal: extra.signal,
        settings: Object.freeze(activeSettings[manifest.id] ?? {}),
        secrets: {
          async get(name) {
            const value = await options.resolveSecret(manifest.id, name);
            if (!value) throw new CapabilityError("missing_secret", "A required capability secret is missing.");
            return value;
          },
          getOptional: (name) => options.resolveSecret(manifest.id, name),
        },
        logger: { info: () => undefined, error: () => undefined },
      };
      try {
        const result = limitCapabilityOutput(await entry.tool.execute(call.params.arguments as never, context));
        return { content: result.content, isError: result.isError ?? false };
      } catch (error) {
        const safe = safeError(error);
        return { isError: true, content: [{ type: "text" as const, text: safe.message }] };
      }
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    try {
      await mcp.connect(transport);
      await transport.handleRequest(request, response, parsed);
    } catch {
      if (!response.headersSent) respondJson(response, 500, { jsonrpc: "2.0", id: null, error: { code: -32603, message: "Capability host request failed." } });
    } finally {
      await transport.close();
      await mcp.close();
    }
  });

  return {
    start: () => new Promise<number>((resolve, reject) => {
      nodeServer.once("error", reject);
      nodeServer.listen(options.port ?? 0, options.hostname ?? "127.0.0.1", () => {
        nodeServer.off("error", reject);
        const address = nodeServer.address();
        if (!address || typeof address === "string") { reject(new CapabilityError("internal_error", "Capability host did not bind.")); return; }
        resolve(address.port);
      });
    }),
    async setActiveCapabilities(ids, settings = {}) {
      const next = new Map<string, ActiveTool>();
      for (const id of ids) {
        const capability = registry(id);
        if (!capability) throw new CapabilityError("invalid_input", "Unknown hosted capability.");
        for (const tool of capability.tools) {
          if (next.has(tool.name)) throw new CapabilityError("invalid_input", "Duplicate hosted tool name.");
          next.set(tool.name, { capability, tool, validate: validators.compile(tool.inputSchema) });
        }
      }
      activeSettings = structuredClone(settings);
      activeTools.clear();
      for (const [name, tool] of next) activeTools.set(name, tool);
      return [...activeTools.keys()];
    },
    close: () => new Promise<void>((resolve, reject) => nodeServer.close((error) => error ? reject(error) : resolve())),
  };
}
