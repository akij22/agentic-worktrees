import { describe, expect, it } from "vitest";
import capability from "./index";
import { validateCapabilityDefinition } from "@agentic-worktrees/capability-sdk";
describe("URL Fetch", () => { it("defines fetch_url", () => { expect(validateCapabilityDefinition(capability)).toBe(capability); expect(capability.tools.map((tool) => tool.name)).toEqual(["fetch_url"]); }); });
