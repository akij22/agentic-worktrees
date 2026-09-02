import { describe, expect, it } from "vitest";
import { buildOpenCodeRuntimeConfig, normalizeOpenCodeIdentifier } from "./opencode-capability-config";

describe("OpenCode capability runtime config", () => {
  it("builds isolated remote MCP profiles with deterministic names", () => {
    const connection = { serverName: "aw_run_1", profileId: "aw_run_1", url: "http://127.0.0.1:1/mcp", authorizationHeader: "Bearer token" };
    expect(buildOpenCodeRuntimeConfig([connection])).toMatchObject({
      mcp: { aw_run_1: { type: "remote", url: connection.url, headers: { Authorization: connection.authorizationHeader } } },
      agent: { aw_run_1: { mode: "primary", permission: { bash: "ask", "aw_*": "deny", "aw_run_1_*": "allow" } } },
    });
    expect(normalizeOpenCodeIdentifier("Run-$Nano.ID")).toBe("run_nano_id");
    expect(normalizeOpenCodeIdentifier(connection.profileId)).not.toContain("token");
  });
});

describe("OpenCode skill configuration",()=>{it("adds trusted roots and skill permission without weakening MCP deny",()=>{expect(buildOpenCodeRuntimeConfig([{serverName:"aw_run_1",url:"http://localhost",authorizationHeader:"Bearer x",profileId:"aw_run_1"}],{activeRoot:"/managed/active",expectedIds:["review"]})).toMatchObject({skills:["/managed/active"],agent:{aw_run_1:{permission:{bash:"ask",skill:"allow","aw_*":"deny","aw_run_1_*":"allow"}}}});});});
