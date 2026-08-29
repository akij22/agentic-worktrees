// The MCP SDK exports ESM subpaths that eslint-import-resolver-typescript does not resolve.
// eslint-disable-next-line import/no-unresolved
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
// eslint-disable-next-line import/no-unresolved
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { defineCapability, defineTool, type CapabilityDefinition } from "@agentic-worktrees/capability-sdk";
import { afterEach, describe, expect, it } from "vitest";
import { createCapabilityHostServer, type CapabilityHostServer } from "./capability-host-server";

const echo = defineCapability({ manifest: { id: "test.echo", name: "Echo", version: "0.1.0", sdkVersion: "^0.1.0", description: "Echo", category: "test", author: { name: "Test" }, license: "MIT", compatibility: { codex: "supported", opencode: "supported" }, permissions: { network: [], secrets: [] }, settings: {} }, tools: [defineTool<{ text: string }>({ name: "echo_text", description: "Echo", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false }, execute: async ({ text }) => ({ content: [{ type: "text", text }] }) })] });

const undeclaredSecret = defineCapability({ manifest: { id: "test.secret-probe", name: "Secret Probe", version: "0.1.0", sdkVersion: "^0.1.0", description: "Probe", category: "test", author: { name: "Test" }, license: "MIT", compatibility: { codex: "supported", opencode: "supported" }, permissions: { network: [], secrets: [] }, settings: {} }, tools: [defineTool({ name: "secret_probe", description: "Probe", inputSchema: { type: "object" }, execute: async (_input, context) => ({ content: [{ type: "text", text: await context.secrets.getOptional("undeclared") ?? "missing" }] }) })] });

const hanging = defineCapability({ manifest: { id: "test.hanging", name: "Hanging", version: "0.1.0", sdkVersion: "^0.1.0", description: "Hangs", category: "test", author: { name: "Test" }, license: "MIT", compatibility: { codex: "supported", opencode: "supported" }, permissions: { network: [], secrets: [] }, settings: {} }, tools: [defineTool({ name: "hang", description: "Hang", inputSchema: { type: "object" }, execute: async () => new Promise(() => undefined) })] });

describe("capability host server", () => {
  let server: CapabilityHostServer | undefined;
  afterEach(async () => server?.close());
  async function client(port: number, token: string) {
    const instance = new Client({ name: "test", version: "1" });
    await instance.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    return instance;
  }
  it("authenticates MCP and applies reviewed tools", async () => {
    server = createCapabilityHostServer({ token: "valid-token", resolveSecret: async () => undefined, registry: (id) => id === "test.echo" ? echo as CapabilityDefinition : undefined });
    const port = await server.start();
    const mcp = await client(port, "valid-token");
    expect((await mcp.listTools()).tools).toEqual([]);
    await server.setActiveCapabilities(["test.echo"]);
    expect((await mcp.listTools()).tools.map((tool) => tool.name)).toEqual(["echo_text"]);
    expect(await mcp.callTool({ name: "echo_text", arguments: { text: "hello" } })).toMatchObject({ content: [{ type: "text", text: "hello" }] });
    await expect(client(port, "wrong-token")).rejects.toThrow();
  });

  it("rejects secret access not declared by the capability manifest", async () => {
    server = createCapabilityHostServer({ token: "valid-token", resolveSecret: async () => "must-not-be-returned", registry: (id) => id === "test.secret-probe" ? undeclaredSecret as CapabilityDefinition : undefined });
    const port = await server.start();
    await server.setActiveCapabilities(["test.secret-probe"]);
    const result = await (await client(port, "valid-token")).callTool({ name: "secret_probe", arguments: {} });
    expect(result).toMatchObject({ isError: true, content: [{ text: "Capability secret access is not declared." }] });
  });

  it("enforces a host-owned tool execution timeout", async () => {
    server = createCapabilityHostServer({ token: "valid-token", executionTimeoutMs: 5, resolveSecret: async () => undefined, registry: (id) => id === "test.hanging" ? hanging as CapabilityDefinition : undefined });
    const port = await server.start();
    await server.setActiveCapabilities(["test.hanging"]);
    const result = await (await client(port, "valid-token")).callTool({ name: "hang", arguments: {} });
    expect(result).toMatchObject({ isError: true, content: [{ text: "Capability execution timed out." }] });
  });
});
