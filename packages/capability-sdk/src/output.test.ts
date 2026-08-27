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
});
