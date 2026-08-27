import { describe, expect, it } from "vitest";
import { defineCapability, defineTool, validateCapabilityDefinition } from "./index";

const manifest = {
  id: "example.echo",
  name: "Echo",
  version: "0.1.0",
  sdkVersion: "^0.1.0",
  description: "Echo text",
  category: "utility",
  author: { name: "Test" },
  license: "MIT",
  compatibility: { codex: "supported", opencode: "supported" } as const,
  permissions: { network: [], secrets: [] },
  settings: {},
};

describe("capability schema", () => {
  it("validates stable manifests and JSON Schema tools", () => {
    const definition = defineCapability({ manifest, tools: [defineTool<{ text: string }>({
      name: "echo_text", description: "Echo", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false },
      execute: async ({ text }) => ({ content: [{ type: "text", text }] }),
    })] });
    expect(validateCapabilityDefinition(definition)).toBe(definition);
    expect(() => validateCapabilityDefinition({ ...definition, manifest: { ...manifest, id: "Invalid ID" } })).toThrow("manifest.id");
  });

  it("rejects duplicate names, invalid schemas, compatibility, and undeclared secrets", () => {
    const tool = defineTool({ name: "echo_text", description: "Echo", inputSchema: { type: "object" }, execute: async () => ({ content: [] }) });
    expect(() => validateCapabilityDefinition(defineCapability({ manifest, tools: [tool, tool] }))).toThrow("Duplicate");
    expect(() => validateCapabilityDefinition(defineCapability({ manifest, tools: [{ ...tool, inputSchema: { type: "unknown" } }] }))).toThrow("JSON Schema");
    expect(() => validateCapabilityDefinition(defineCapability({ manifest: { ...manifest, compatibility: { codex: "maybe", opencode: "supported" } } as never, tools: [] }))).toThrow("compatibility.codex");
    expect(() => validateCapabilityDefinition(defineCapability({ manifest: { ...manifest, settings: { token: { type: "secret", required: false } } }, tools: [] }))).toThrow("not declared");
  });
});
