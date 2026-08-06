// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Api } from "../../../../shared/ipc/api";
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
  hasUnviewedChanges: false,
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

const InteractiveComposer = ({
  initialDraft,
  onSend = () => undefined,
}: {
  initialDraft: string;
  onSend?: () => void;
}) => {
  const [draft, setDraft] = useState(initialDraft);
  return (
    <SessionComposer
      session={createSession("codex")}
      draft={draft}
      models={[]}
      modelKey="provider::model"
      reasoningVariant=""
      reasoningVariants={[]}
      loadingModels={false}
      changingModel={false}
      busy={false}
      locked={false}
      onDraftChange={setDraft}
      onModelChange={() => undefined}
      onReasoningChange={() => undefined}
      onSend={onSend}
      onStop={() => undefined}
      onSlashCommand={() => undefined}
    />
  );
};

describe("SessionComposer slash commands", () => {
  it.each(["opencode", "codex"] as const)(
    "renders the command palette for %s",
    (agentKind) => {
      const markup = renderComposer(agentKind);

      expect(markup).toContain('aria-label="Session slash commands"');
      expect(markup).toContain("/status");
      expect(markup).toContain("/compact");
      expect(markup).toContain("/model");
      expect(markup).toContain("/stop");
    },
  );
});

describe("SessionComposer file mentions", () => {
  const search = vi.fn<Api["workspace"]["files"]["search"]>();

  beforeEach(() => {
    vi.useFakeTimers();
    search.mockReset();
    Object.defineProperty(window, "api", {
      configurable: true,
      value: {
        workspace: { files: { search } },
      } as unknown as Api,
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const openFilePalette = async () => {
    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });
    return screen.getByRole("listbox", { name: "Worktree files" });
  };

  it("selects a worktree file at the caret with the keyboard", async () => {
    search.mockResolvedValueOnce([
      "src/Session.tsx",
      "src/SessionCard.tsx",
    ]);
    render(<InteractiveComposer initialDraft="Fix @Ses" />);
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    const palette = await openFilePalette();

    expect(within(palette).getByText("src/Session.tsx")).toBeTruthy();
    fireEvent.keyDown(textarea, { key: "ArrowDown" });
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(textarea.value).toBe("Fix @src/SessionCard.tsx ");
    expect(textarea.selectionStart).toBe(textarea.value.length);
  });

  it("selects a worktree file with the mouse", async () => {
    search.mockResolvedValueOnce(["src/Session.tsx"]);
    render(<InteractiveComposer initialDraft="Fix @Ses" />);
    await openFilePalette();

    fireEvent.click(screen.getByRole("option", { name: "src/Session.tsx" }));

    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      "Fix @src/Session.tsx ",
    );
  });

  it("dismisses file suggestions without clearing the draft", async () => {
    search.mockResolvedValueOnce(["src/Session.tsx"]);
    render(<InteractiveComposer initialDraft="Fix @Ses" />);
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await openFilePalette();

    fireEvent.keyDown(textarea, { key: "Escape" });

    expect(textarea.value).toBe("Fix @Ses");
    expect(screen.queryByRole("listbox", { name: "Worktree files" })).toBeNull();
  });

  it("shows empty and error states while leaving the textarea usable", async () => {
    search.mockResolvedValueOnce([]);
    const { unmount } = render(
      <InteractiveComposer initialDraft="Review @missing" />,
    );
    await openFilePalette();
    expect(screen.getByText("No matching files")).toBeTruthy();
    unmount();

    search.mockRejectedValueOnce(new Error("git failed"));
    render(<InteractiveComposer initialDraft="Review @broken" />);
    await openFilePalette();
    expect(screen.getByText("Could not search worktree files.")).toBeTruthy();
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(
      false,
    );
  });

  it("keeps Shift+Enter as a newline gesture instead of selecting", async () => {
    const onSend = vi.fn();
    search.mockResolvedValueOnce(["src/Session.tsx"]);
    render(<InteractiveComposer initialDraft="Fix @Ses" onSend={onSend} />);
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    await openFilePalette();

    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });

    expect(textarea.value).toBe("Fix @Ses");
    expect(onSend).not.toHaveBeenCalled();
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

  it("renders Codex usage without any cost copy", () => {
    const markup = renderToStaticMarkup(
      <SessionStatusPopup
        session={createSession("codex")}
        usage={{
          contextTokens: 40_000,
          contextWindow: 200_000,
          contextPercentage: 20,
          providerId: "openai",
          modelId: "gpt-5.4",
        }}
        loading={false}
        onClose={() => undefined}
      />,
    );

    expect(markup).toContain("Codex status");
    expect(markup).toContain("20.0%");
    expect(markup).toContain("openai/gpt-5.4");
    expect(markup).not.toContain("Spent");
    expect(markup).not.toContain("$");
    expect(markup.toLowerCase()).not.toContain("unavailable");
    expect(markup.toLowerCase()).not.toContain("not available");
  });
});
