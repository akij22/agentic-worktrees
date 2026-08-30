import { describe, expect, it } from "vitest";
import { limitCapabilityOutput } from "./output";

describe("limitCapabilityOutput", () => {
  it("limits line and byte output with a deterministic notice", () => {
    for (const text of ["x\n".repeat(2_100), "é".repeat(60_000)]) {
      const limited = limitCapabilityOutput({ content: [{ type: "text", text }] });
      expect(limited.content[0]?.text).toContain("[Capability output truncated]");
      expect(Buffer.byteLength(limited.content[0]?.text ?? "")).toBeLessThanOrEqual(50 * 1024);
      expect((limited.content[0]?.text.split("\n").length ?? 0)).toBeLessThanOrEqual(2_000);
    }
  });

  it("prioritizes MCP text before adding JSON details to the shared byte budget", () => {
    const text = "c".repeat(30 * 1024);
    const limited = limitCapabilityOutput({ content: [{ type: "text", text }], details: { value: "d".repeat(30 * 1024) } });
    const contentBytes = Buffer.byteLength(limited.content[0]?.text ?? "");
    expect(limited.content[0]?.text).toBe(text);
    expect(contentBytes).toBe(30 * 1024);
    expect(limited).not.toHaveProperty("details");
  });

  it("omits JSON details that exceed the output boundary or cannot be serialized", () => {
    expect(limitCapabilityOutput({ content: [{ type: "text", text: "ok" }], details: { value: "x".repeat(60_000) } })).not.toHaveProperty("details");
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(limitCapabilityOutput({ content: [{ type: "text", text: "ok" }], details: cyclic })).not.toHaveProperty("details");
    expect(limitCapabilityOutput({ content: [{ type: "text", text: "ok" }], details: { value: "bounded" } })).toHaveProperty("details", { value: "bounded" });
  });
});
