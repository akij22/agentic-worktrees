import { randomUUID, timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import AjvConstructor, { type ValidateFunction } from "ajv";
// The MCP SDK exports ESM subpaths that eslint-import-resolver-typescript does not resolve.
// eslint-disable-next-line import/no-unresolved
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
// eslint-disable-next-line import/no-unresolved
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
// eslint-disable-next-line import/no-unresolved
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"; // eslint-disable-line import/no-unresolved
import {
  CapabilityError,
  limitCapabilityOutput,
  type CapabilityDefinition,
  type CapabilityExecutionContext,
  type CapabilityTool,
} from "@agentic-worktrees/capability-sdk";
import { getHostedCapability } from "./host-registry";
import type { CapabilityRuntimeDescriptor } from "./catalog";

import type {
  CapabilityHostOutcome,
  CapabilityHostObservation,
} from "./capability-receipt";
export type {
  CapabilityHostOutcome,
  CapabilityHostObservation,
} from "./capability-receipt";

export interface CapabilityHostServerOptions {
  token: string;
  port?: number;
  hostname?: "127.0.0.1" | "::1";
  resolveSecret(
    capabilityId: string,
    settingKey: string,
  ): Promise<string | undefined>;
  registry?: (
    descriptor: CapabilityRuntimeDescriptor,
  ) => Promise<CapabilityDefinition | undefined>;
  executionTimeoutMs?: number;
  runtimeGenerationId?: string;
  onObservation?(observation: CapabilityHostObservation): void;
  onObservationError?(code: "capability_host_observation_failed"): void;
}

export interface CapabilityHostServer {
  start(): Promise<number>;
  setActiveCapabilities(
    descriptors: readonly CapabilityRuntimeDescriptor[],
    settings?: Record<string, Record<string, unknown>>,
  ): Promise<string[]>;
  close(): Promise<void>;
  cancelInvocation(runtimeGenerationId: string, invocationId: string): boolean;
}

interface ActiveTool {
  capability: CapabilityDefinition;
  tool: CapabilityTool<unknown>;
  validate: ValidateFunction;
}

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
    if (size > 1024 * 1024)
      throw new CapabilityError("invalid_input", "MCP request is too large.");
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new CapabilityError("invalid_input", "Invalid MCP request.");
  }
}
function safeError(error: unknown): CapabilityError {
  if (error instanceof CapabilityError) return error;
  if (error instanceof Error && error.name === "AbortError")
    return new CapabilityError(
      "cancelled",
      "Capability execution was cancelled.",
    );
  return new CapabilityError("internal_error", "Capability execution failed.");
}
function respondJson(
  response: ServerResponse,
  status: number,
  value: unknown,
): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value));
}

class HostBoundaryError extends CapabilityError {
  constructor(readonly outcome: "timeout" | "cancelled") {
    super(
      outcome === "cancelled" ? "cancelled" : "upstream_unavailable",
      outcome === "cancelled"
        ? "Capability execution was cancelled."
        : "Capability execution timed out.",
    );
  }
}

async function executeWithDeadline<T>(
  execute: (signal: AbortSignal) => Promise<T>,
  callerSignal: AbortSignal,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  let rejectBoundary!: (error: CapabilityError) => void;
  const boundary = new Promise<never>((_resolve, reject) => {
    rejectBoundary = reject;
  });
  const cancel = () => {
    rejectBoundary(new HostBoundaryError("cancelled"));
    controller.abort();
  };
  if (callerSignal.aborted) cancel();
  else callerSignal.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    rejectBoundary(new HostBoundaryError("timeout"));
    controller.abort();
  }, timeoutMs);
  try {
    return await Promise.race([execute(controller.signal), boundary]);
  } finally {
    clearTimeout(timer);
    callerSignal.removeEventListener("abort", cancel);
    if (!timedOut && callerSignal.aborted) controller.abort();
  }
}

export function createCapabilityHostServer(
  options: CapabilityHostServerOptions,
): CapabilityHostServer {
  if (
    options.hostname &&
    options.hostname !== "127.0.0.1" &&
    options.hostname !== "::1"
  ) {
    throw new CapabilityError(
      "permission_denied",
      "Capability hosts must bind to loopback.",
    );
  }
  const notify = (observation: CapabilityHostObservation) => {
    try {
      options.onObservation?.(observation);
    } catch {
      try {
        if (options.onObservationError)
          options.onObservationError("capability_host_observation_failed");
        else console.error("capability_host_observation_failed");
      } catch {
        console.error("capability_host_observation_failed");
      }
    }
  };
  // Receipt transport belongs to the owned-runtime observation bridge, not legacy global hosts.
  const receiptsEnabled = Boolean(
    options.runtimeGenerationId || options.onObservation,
  );
  const registry = options.registry ?? getHostedCapability;
  const validators = new AjvConstructor({ strict: true, allErrors: true });
  const activeTools = new Map<string, ActiveTool>();
  const invocations = new Map<string, AbortController>();
  let activeSettings: Record<string, Record<string, unknown>> = {};

  const nodeServer = createServer(async (request, response) => {
    if (request.url !== "/mcp") {
      respondJson(response, 404, { error: "Not found" });
      return;
    }
    if (!authorized(request.headers.authorization, options.token)) {
      respondJson(response, 401, { error: "Unauthorized" });
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(405).end();
      return;
    }
    let parsed: unknown;
    try {
      parsed = await body(request);
    } catch (error) {
      const safe = safeError(error);
      respondJson(response, 400, {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: safe.message },
      });
      return;
    }

    const mcp = new Server(
      { name: "agentic-worktrees", version: "0.1.0" },
      { capabilities: { tools: { listChanged: true } } },
    );
    mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [...activeTools.values()].map(({ tool }) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    }));
    mcp.setRequestHandler(CallToolRequestSchema, async (call) => {
      const entry = activeTools.get(call.params.name);
      if (!entry)
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "Unknown or inactive capability tool.",
            },
          ],
        };
      if (!entry.validate(call.params.arguments ?? {}))
        return {
          isError: true,
          content: [
            { type: "text" as const, text: "Invalid capability tool input." },
          ],
        };
      const manifest = entry.capability.manifest;
      const resolveDeclaredSecret = async (
        name: string,
      ): Promise<string | undefined> => {
        const setting = manifest.settings[name];
        const permissionName = name.replace(
          /[A-Z]/g,
          (letter) => `-${letter.toLowerCase()}`,
        );
        if (
          setting?.type !== "secret" ||
          !manifest.permissions.secrets.includes(permissionName)
        ) {
          throw new CapabilityError(
            "permission_denied",
            "Capability secret access is not declared.",
          );
        }
        return options.resolveSecret(manifest.id, name);
      };
      const contextBase = {
        settings: Object.freeze(activeSettings[manifest.id] ?? {}),
        secrets: {
          async get(name) {
            const value = await resolveDeclaredSecret(name);
            if (!value)
              throw new CapabilityError(
                "missing_secret",
                "A required capability secret is missing.",
              );
            return value;
          },
          getOptional: resolveDeclaredSecret,
        },
        logger: { info: () => undefined, error: () => undefined },
      } satisfies Omit<CapabilityExecutionContext, "signal">;
      const invocationId = randomUUID();
      const observation = {
        invocationId,
        capabilityId: manifest.id,
        capabilityVersion: manifest.version,
        toolName: entry.tool.name,
      };
      const cancellation = new AbortController();
      invocations.set(invocationId, cancellation);
      notify({ ...observation, type: "entered" });
      const finish = (outcome: CapabilityHostOutcome) => {
        notify({ ...observation, type: "outcome", outcome });
        return {
          "aw.capabilityReceipt": { version: 1, invocationId, outcome },
        };
      };
      try {
        const result = limitCapabilityOutput(
          await executeWithDeadline(
            (signal) =>
              entry.tool.execute(call.params.arguments, {
                ...contextBase,
                signal,
              }),
            cancellation.signal,
            options.executionTimeoutMs ?? 30_000,
          ),
        );
        const meta = finish(result.isError ? "reported_error" : "success");
        if (!receiptsEnabled)
          return { content: result.content, isError: result.isError ?? false };
        return {
          content: [
            ...result.content,
            {
              type: "text" as const,
              text: JSON.stringify({
                awCapabilityReceipt: meta["aw.capabilityReceipt"],
              }),
            },
          ],
          isError: result.isError ?? false,
          _meta: meta,
        };
      } catch (error) {
        const safe = safeError(error);
        const meta = finish(
          error instanceof HostBoundaryError ? error.outcome : "thrown",
        );
        if (!receiptsEnabled)
          return {
            isError: true,
            content: [{ type: "text" as const, text: safe.message }],
          };
        return {
          isError: true,
          content: [
            { type: "text" as const, text: safe.message },
            {
              type: "text" as const,
              text: JSON.stringify({
                awCapabilityReceipt: meta["aw.capabilityReceipt"],
              }),
            },
          ],
          _meta: meta,
        };
      } finally {
        invocations.delete(invocationId);
      }
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    try {
      await mcp.connect(transport);
      await transport.handleRequest(request, response, parsed);
    } catch {
      if (!response.headersSent)
        respondJson(response, 500, {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32603, message: "Capability host request failed." },
        });
    } finally {
      await transport.close();
      await mcp.close();
    }
  });

  return {
    cancelInvocation(runtimeGenerationId, invocationId) {
      if (
        !options.runtimeGenerationId ||
        runtimeGenerationId !== options.runtimeGenerationId
      )
        return false;
      const active = invocations.get(invocationId);
      if (!active || active.signal.aborted) return false;
      active.abort();
      return true;
    },
    start: () =>
      new Promise<number>((resolve, reject) => {
        nodeServer.once("error", reject);
        nodeServer.listen(
          options.port ?? 0,
          options.hostname ?? "127.0.0.1",
          () => {
            nodeServer.off("error", reject);
            const address = nodeServer.address();
            if (!address || typeof address === "string") {
              reject(
                new CapabilityError(
                  "internal_error",
                  "Capability host did not bind.",
                ),
              );
              return;
            }
            resolve(address.port);
          },
        );
      }),
    async setActiveCapabilities(descriptors, settings = {}) {
      const next = new Map<string, ActiveTool>();
      for (const descriptor of descriptors) {
        const capability = await registry(descriptor);
        if (!capability)
          throw new CapabilityError(
            "invalid_input",
            "Unknown hosted capability.",
          );
        for (const tool of capability.tools) {
          if (next.has(tool.name))
            throw new CapabilityError(
              "invalid_input",
              "Duplicate hosted tool name.",
            );
          next.set(tool.name, {
            capability,
            tool,
            validate: validators.compile(tool.inputSchema),
          });
        }
      }
      activeSettings = structuredClone(settings);
      activeTools.clear();
      for (const [name, tool] of next) activeTools.set(name, tool);
      return [...activeTools.keys()];
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        nodeServer.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
