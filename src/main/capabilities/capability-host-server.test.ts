import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { defineCapability, defineTool, type CapabilityDefinition } from "@agentic-worktrees/capability-sdk";
import { afterEach, describe, expect, it } from "vitest";
import { createCapabilityHostServer, type CapabilityHostServer } from "./capability-host-server";

const echo = defineCapability({ manifest: { id: "test.echo", name: "Echo", version: "0.1.0", sdkVersion: "^0.1.0", description: "Echo", category: "test", author: { name: "Test" }, license: "MIT", compatibility: { codex: "supported", opencode: "supported" }, permissions: { network: [], secrets: [] }, settings: {} }, tools: [defineTool<{ text: string }>({ name: "echo_text", description: "Echo", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false }, execute: async ({ text }) => ({ content: [{ type: "text", text }] }) })] });

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
});
