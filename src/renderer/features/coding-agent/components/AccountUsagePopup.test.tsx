import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { CodingAgentSessionDto } from "../../../../shared/ipc/schemas";
import { AccountUsagePopup } from "./AccountUsagePopup";

const session: CodingAgentSessionDto = {
  id: "run-1",
  agentKind: "codex",
  agentName: "Codex",
  worktreeId: "worktree-1",
  repositoryId: "repository-1",
  title: "Session",
  status: "idle",
  errorMessage: null,
  hasUnviewedChanges: false,
  providerId: "openai",
  modelId: "gpt-5.4",
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

describe("AccountUsagePopup", () => {
  it("shows Codex account quota remaining and reset windows", () => {
    const markup = renderToStaticMarkup(
      <AccountUsagePopup
        session={session}
        loading={false}
        accountUsage={{
          providerId: "openai",
          availability: "available",
          planType: "plus",
          windows: [
            {
              durationMinutes: 300,
              remainingPercentage: 77,
              resetsAt: 1_800_000_000_000,
            },
          ],
        }}
        sessionUsage={{
          contextTokens: 40_000,
          contextWindow: 200_000,
          contextPercentage: 20,
          providerId: "openai",
          modelId: "gpt-5.4",
        }}
        onClose={() => undefined}
      />,
    );

    expect(markup).toContain("Remaining account usage");
    expect(markup).toContain("77% remaining");
    expect(markup).toContain("5h window");
    expect(markup).toContain("Plus plan");
  });

  it("explains unavailable OpenCode account quota while retaining session usage", () => {
    const markup = renderToStaticMarkup(
      <AccountUsagePopup
        session={{ ...session, agentKind: "opencode", agentName: "OpenCode" }}
        loading={false}
        accountUsage={{
          providerId: "anthropic",
          availability: "unavailable",
          message:
            "OpenCode does not expose a provider-independent account usage API.",
          windows: [],
        }}
        sessionUsage={{
          contextTokens: 20_000,
          contextWindow: 200_000,
          contextPercentage: 10,
          totalCost: 1.25,
          providerId: "anthropic",
          modelId: "claude-sonnet",
        }}
        onClose={() => undefined}
      />,
    );

    expect(markup).toContain("Account quota unavailable");
    expect(markup).toContain("provider-independent account usage API");
    expect(markup).toContain("Session context");
    expect(markup).toContain("10.0%");
    expect(markup).toContain("$1.25");
  });
});
