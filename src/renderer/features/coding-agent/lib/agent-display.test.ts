import { describe, expect, it } from "vitest";
import { getAgentDisplay } from "./agent-display";

describe("getAgentDisplay", () => {
  it("builds harness-specific activity and accessibility copy", () => {
    expect(getAgentDisplay("Codex")).toEqual({
      working: "Codex is working…",
      empty: "Ask Codex to make a change in this worktree.",
      placeholder: "Describe the change you want Codex to make…",
      stopLabel: "Stop Codex",
      messageLabel: "Codex message",
      permissionTitle: "Codex requests permission",
      exitError: "The Codex server stopped unexpectedly.",
    });
  });
});
