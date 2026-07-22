import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CodingAgentSessionDto } from "../../../../shared/ipc/schemas";
import { SessionComposer } from "./SessionComposer";
import { SessionStatusPopup } from "./SessionStatusPopup";

const createSession = (
  agentKind: CodingAgentSessionDto["agentKind"],
): CodingAgentSessionDto => ({
  id: "run-1",
  agentKind,
  agentName: agentKind === "opencode" ? "OpenCode" : "Codex",
  worktreeId: "worktree-1",
  repositoryId: "repository-1",
  title: "Session",
  status: "idle",
  errorMessage: null,
  providerId: "provider",
  modelId: "model",
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

const renderComposer = (agentKind: CodingAgentSessionDto["agentKind"]) =>
  renderToStaticMarkup(
    <SessionComposer
      session={createSession(agentKind)}
      draft="/"
      models={[]}
      modelKey="provider::model"
      reasoningVariant=""
      reasoningVariants={[]}
      loadingModels={false}
      changingModel={false}
      busy={false}
      locked={false}
      onDraftChange={() => undefined}
      onModelChange={() => undefined}
      onReasoningChange={() => undefined}
      onSend={() => undefined}
      onStop={() => undefined}
      onSlashCommand={() => undefined}
    />,
  );

describe("SessionComposer slash commands", () => {
  it("renders the OpenCode command palette", () => {
    const markup = renderComposer("opencode");

    expect(markup).toContain('aria-label="OpenCode slash commands"');
    expect(markup).toContain("/status");
    expect(markup).toContain("/compact");
    expect(markup).toContain("/model");
    expect(markup).toContain("/stop");
  });

  it("does not expose OpenCode commands in Codex sessions", () => {
    expect(renderComposer("codex")).not.toContain(
      'aria-label="OpenCode slash commands"',
    );
  });
});

describe("SessionStatusPopup", () => {
  it("renders context usage, total cost, and current model", () => {
    const markup = renderToStaticMarkup(
      <SessionStatusPopup
        session={createSession("opencode")}
        usage={{
          contextTokens: 50_000,
          contextWindow: 200_000,
          contextPercentage: 25,
          totalCost: 1.2345,
          providerId: "anthropic",
          modelId: "claude-sonnet",
        }}
        loading={false}
        onClose={() => undefined}
      />,
    );

    expect(markup).toContain("25.0%");
    expect(markup).toContain("50,000 / 200,000 tokens");
    expect(markup).toContain("$1.2345");
    expect(markup).toContain("anthropic/claude-sonnet");
    expect(markup).toContain("absolute bottom-full right-4");
    expect(markup).not.toContain("fixed bottom-5 right-5");
  });
});
