import { describe, expect, it } from "vitest";
import { getHostedCapability, listHostedCapabilityIds } from "./host-registry";

describe("host registry", () => {
  it("exposes only frozen explicit hosted IDs", () => {
    const ids = listHostedCapabilityIds();
    expect(ids).toEqual(["agentic-worktrees.web-search"]);
    expect(Object.isFrozen(ids)).toBe(true);
  });
  it("returns undefined for unknown capabilities", () => {
    expect(getHostedCapability("unknown.capability")).toBeUndefined();
  });
});
