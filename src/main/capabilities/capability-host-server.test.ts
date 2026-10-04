// The MCP SDK exports ESM subpaths that eslint-import-resolver-typescript does not resolve.
// eslint-disable-next-line import/no-unresolved
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
// eslint-disable-next-line import/no-unresolved
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  defineCapability,
  defineTool,
  type CapabilityDefinition,
} from "@agentic-worktrees/capability-sdk";
import {
  readCapabilityReceipt,
  stripCapabilityReceiptText,
} from "./capability-receipt";
import { afterEach, describe, expect, it } from "vitest";
import {
  createCapabilityHostServer,
  type CapabilityHostServer,
} from "./capability-host-server";

const echo = defineCapability({
  manifest: {
    id: "test.echo",
    name: "Echo",
    version: "0.1.0",
    sdkVersion: "^0.1.0",
    description: "Echo",
    category: "test",
    author: { name: "Test" },
    license: "MIT",
    compatibility: { codex: "supported", opencode: "supported" },
    permissions: { network: [], secrets: [] },
    settings: {},
  },
  tools: [
    defineTool<{ text: string }>({
      name: "echo_text",
      description: "Echo",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
      execute: async ({ text }) => ({ content: [{ type: "text", text }] }),
    }),
  ],
});

const undeclaredSecret = defineCapability({
  manifest: {
    id: "test.secret-probe",
    name: "Secret Probe",
    version: "0.1.0",
    sdkVersion: "^0.1.0",
    description: "Probe",
    category: "test",
    author: { name: "Test" },
    license: "MIT",
    compatibility: { codex: "supported", opencode: "supported" },
    permissions: { network: [], secrets: [] },
    settings: {},
  },
  tools: [
    defineTool({
      name: "secret_probe",
      description: "Probe",
      inputSchema: { type: "object" },
      execute: async (_input, context) => ({
        content: [
          {
            type: "text",
            text:
              (await context.secrets.getOptional("undeclared")) ?? "missing",
          },
        ],
      }),
    }),
  ],
});

const runtime = (capabilityId: string) => ({
  kind: "bundled" as const,
  capabilityId,
  version: "0.1.0",
});

const hanging = defineCapability({
  manifest: {
    id: "test.hanging",
    name: "Hanging",
    version: "0.1.0",
    sdkVersion: "^0.1.0",
    description: "Hangs",
    category: "test",
    author: { name: "Test" },
    license: "MIT",
    compatibility: { codex: "supported", opencode: "supported" },
    permissions: { network: [], secrets: [] },
    settings: {},
  },
  tools: [
    defineTool({
      name: "hang",
      description: "Hang",
      inputSchema: { type: "object" },
      execute: async () => new Promise(() => undefined),
    }),
  ],
});

describe("capability host server", () => {
  let server: CapabilityHostServer | undefined;
  afterEach(async () => server?.close());
  async function client(port: number, token: string) {
    const instance = new Client({ name: "test", version: "1" });
    await instance.connect(
      new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${port}/mcp`),
        { requestInit: { headers: { Authorization: `Bearer ${token}` } } },
      ),
    );
    return instance;
  }
  it("authenticates MCP and applies reviewed tools", async () => {
    server = createCapabilityHostServer({
      token: "valid-token",
      resolveSecret: async () => undefined,
      registry: async (descriptor) =>
        descriptor.capabilityId === "test.echo"
          ? (echo as CapabilityDefinition)
          : undefined,
    });
    const port = await server.start();
    const mcp = await client(port, "valid-token");
    expect((await mcp.listTools()).tools).toEqual([]);
    await server.setActiveCapabilities([runtime("test.echo")]);
    expect((await mcp.listTools()).tools.map((tool) => tool.name)).toEqual([
      "echo_text",
    ]);
    expect(
      await mcp.callTool({ name: "echo_text", arguments: { text: "hello" } }),
    ).toMatchObject({
      content: expect.arrayContaining([{ type: "text", text: "hello" }]),
    });
    await expect(client(port, "wrong-token")).rejects.toThrow();
  });

  it("rejects secret access not declared by the capability manifest", async () => {
    server = createCapabilityHostServer({
      token: "valid-token",
      resolveSecret: async () => "must-not-be-returned",
      registry: async (descriptor) =>
        descriptor.capabilityId === "test.secret-probe"
          ? (undeclaredSecret as CapabilityDefinition)
          : undefined,
    });
    const port = await server.start();
    await server.setActiveCapabilities([runtime("test.secret-probe")]);
    const result = await (
      await client(port, "valid-token")
    ).callTool({ name: "secret_probe", arguments: {} });
    expect(result).toMatchObject({
      isError: true,
      content: expect.arrayContaining([
        expect.objectContaining({
          text: "Capability secret access is not declared.",
        }),
      ]),
    });
  });

  it("enforces a host-owned tool execution timeout", async () => {
    server = createCapabilityHostServer({
      token: "valid-token",
      executionTimeoutMs: 5,
      resolveSecret: async () => undefined,
      registry: async (descriptor) =>
        descriptor.capabilityId === "test.hanging"
          ? (hanging as CapabilityDefinition)
          : undefined,
    });
    const port = await server.start();
    await server.setActiveCapabilities([runtime("test.hanging")]);
    const result = await (
      await client(port, "valid-token")
    ).callTool({ name: "hang", arguments: {} });
    expect(result).toMatchObject({
      isError: true,
      content: expect.arrayContaining([
        expect.objectContaining({ text: "Capability execution timed out." }),
      ]),
    });
  });
  it("emits handler entry and success with a host-owned receipt preserved in MCP", async () => {
    const observations: unknown[] = [];
    server = createCapabilityHostServer({
      token: "valid-token",
      resolveSecret: async () => undefined,
      registry: async () => echo as CapabilityDefinition,
      onObservation: (observation) => observations.push(observation),
    });
    await server.setActiveCapabilities([runtime("test.echo")]);
    const mcp = await client(await server.start(), "valid-token");
    const result = await mcp.callTool({
      name: "echo_text",
      arguments: { text: "private-input" },
    });
    expect(result).toMatchObject({
      _meta: {
        "aw.capabilityReceipt": {
          version: 1,
          invocationId: expect.any(String),
          outcome: "success",
        },
      },
    });
    expect(observations).toEqual([
      {
        type: "entered",
        invocationId: expect.any(String),
        capabilityId: "test.echo",
        capabilityVersion: "0.1.0",
        toolName: "echo_text",
      },
      {
        type: "outcome",
        invocationId: expect.any(String),
        capabilityId: "test.echo",
        capabilityVersion: "0.1.0",
        toolName: "echo_text",
        outcome: "success",
      },
    ]);
    expect(JSON.stringify(observations)).not.toContain("private-input");
    expect(observations[0]).toMatchObject({
      invocationId: (
        result._meta?.["aw.capabilityReceipt"] as { invocationId: string }
      ).invocationId,
    });
    await mcp.close();
  });

  it("retains the same receipt and typed timeout after handler entry", async () => {
    const observations: unknown[] = [];
    server = createCapabilityHostServer({
      token: "valid-token",
      executionTimeoutMs: 5,
      resolveSecret: async () => undefined,
      registry: async () => hanging as CapabilityDefinition,
      onObservation: (event) => observations.push(event),
    });
    await server.setActiveCapabilities([runtime("test.hanging")]);
    const mcp = await client(await server.start(), "valid-token");
    const result = await mcp.callTool({ name: "hang", arguments: {} });
    expect(result).toMatchObject({
      _meta: { "aw.capabilityReceipt": { outcome: "timeout" } },
    });
    expect(observations).toMatchObject([
      { type: "entered" },
      { type: "outcome", outcome: "timeout" },
    ]);
    await mcp.close();
  });

  it("cancels only the exact active receipt in the owned runtime", async () => {
    const ids: string[] = [];
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    server = createCapabilityHostServer({
      token: "valid-token",
      runtimeGenerationId: "runtime-one",
      executionTimeoutMs: 1000,
      resolveSecret: async () => undefined,
      registry: async () => hanging as CapabilityDefinition,
      onObservation: (event) => {
        if (event.type === "entered") {
          ids.push(event.invocationId);
          if (ids.length === 2) entered();
        }
      },
    });
    await server.setActiveCapabilities([runtime("test.hanging")]);
    const mcp = await client(await server.start(), "valid-token");
    const first = mcp.callTool({ name: "hang", arguments: {} });
    const second = mcp.callTool({ name: "hang", arguments: {} });
    await ready;
    expect(server.cancelInvocation("stale-runtime", ids[0])).toBe(false);
    expect(server.cancelInvocation("runtime-one", "unknown")).toBe(false);
    expect(server.cancelInvocation("runtime-one", ids[0])).toBe(true);
    expect(await first).toMatchObject({
      _meta: {
        "aw.capabilityReceipt": { invocationId: ids[0], outcome: "cancelled" },
      },
    });
    expect(server.cancelInvocation("runtime-one", ids[0])).toBe(false);
    expect(server.cancelInvocation("runtime-one", ids[1])).toBe(true);
    expect(await second).toMatchObject({
      _meta: {
        "aw.capabilityReceipt": { invocationId: ids[1], outcome: "cancelled" },
      },
    });
    await mcp.close();
  });

  it("preserves receipts outside Capability-controlled output for errors and retries", async () => {
    const observations: unknown[] = [];
    const failing = defineCapability({
      ...echo,
      tools: [
        defineTool({
          name: "fail",
          description: "Fail",
          inputSchema: { type: "object" },
          execute: async () => ({
            isError: true,
            content: [{ type: "text", text: "reported failure" }],
          }),
        }),
      ],
    });
    server = createCapabilityHostServer({
      token: "valid-token",
      resolveSecret: async () => undefined,
      registry: async () => failing as CapabilityDefinition,
      onObservation: (event) => observations.push(event),
    });
    await server.setActiveCapabilities([runtime("test.echo")]);
    const mcp = await client(await server.start(), "valid-token");
    const first = await mcp.callTool({ name: "fail", arguments: {} });
    const second = await mcp.callTool({ name: "fail", arguments: {} });
    expect(first).toMatchObject({
      _meta: { "aw.capabilityReceipt": { outcome: "reported_error" } },
    });
    expect(first.content).toContainEqual({
      type: "text",
      text: JSON.stringify({
        awCapabilityReceipt: first._meta?.["aw.capabilityReceipt"],
      }),
    });
    expect(first._meta).not.toEqual(second._meta);
    expect(observations).toHaveLength(4);
    await mcp.close();
  });

  it("preserves a terminal receipt once even if observation delivery fails", async () => {
    const observations: unknown[] = [];
    const errors: string[] = [];
    server = createCapabilityHostServer({
      token: "valid-token",
      resolveSecret: async () => undefined,
      registry: async () => echo as CapabilityDefinition,
      onObservation: (event) => {
        observations.push(event);
        if (event.type === "outcome") throw new Error("private-delivery-error");
      },
      onObservationError: (code) => errors.push(code),
    });
    await server.setActiveCapabilities([runtime("test.echo")]);
    const mcp = await client(await server.start(), "valid-token");
    const result = await mcp.callTool({
      name: "echo_text",
      arguments: { text: "public-result" },
    });
    expect(result.isError).toBe(false);
    expect(observations).toHaveLength(2);
    const receipt = readCapabilityReceipt(result);
    expect(receipt?.outcome).toBe("success");
    expect(stripCapabilityReceiptText(JSON.stringify(result))).not.toContain(
      receipt?.invocationId,
    );
    expect(errors).toEqual(["capability_host_observation_failed"]);
    await mcp.close();
  });
  it("keeps receipts private until an owned-runtime observation bridge is attached", async () => {
    server = createCapabilityHostServer({
      token: "valid-token",
      resolveSecret: async () => undefined,
      registry: async () => echo as CapabilityDefinition,
    });
    await server.setActiveCapabilities([runtime("test.echo")]);
    const mcp = await client(await server.start(), "valid-token");
    const result = await mcp.callTool({
      name: "echo_text",
      arguments: { text: "hello" },
    });
    expect(result._meta).toBeUndefined();
    expect(result.content).toEqual([{ type: "text", text: "hello" }]);
    await mcp.close();
  });
});
