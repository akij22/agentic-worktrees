import { describe, expect, it } from "vitest";
import { getBundledCapability, listBundledCapabilities, toCapabilityDetailDto } from "./catalog";

describe("bundled capability catalog", () => {
  it("lists and safely projects immutable reviewed capabilities", () => {
    const listed = listBundledCapabilities();
    expect(Object.isFrozen(listed)).toBe(true);
    const detail = toCapabilityDetailDto(getBundledCapability("agentic-worktrees.web-search"));
    expect(detail.compatibility).toEqual({ codex: "supported", opencode: "supported" });
    expect(JSON.stringify(detail)).not.toMatch(/bearerToken|endpoint|secretValue|execute/);
    expect(detail.providedTools).toEqual(["web_search"]);
  });

  it("rejects unknown IDs without echoing them", () => {
    expect(() => getBundledCapability("secret-user-input")).toThrow("Unknown capability.");
  });
});
