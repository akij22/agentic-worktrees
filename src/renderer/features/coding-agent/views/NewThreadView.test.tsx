// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { CodingAgentInstallationStatusDto } from "../../../../shared/ipc/schemas";
import { NewThreadView } from "./NewThreadView";

const context = {
  repository: {
    id: "repo-a",
    githubRepoId: 1,
    ownerLogin: "owner",
    name: "agentic-worktrees",
    fullName: "owner/agentic-worktrees",
    defaultBranch: "main",
    isPrivate: true,
    isArchived: false,
    cloneUrl: "https://example.com/repository.git",
    sshUrl: null,
    htmlUrl: "https://example.com/repository",
    localRootPath: "/Users/example/agentic-worktrees",
    localCloneStatus: "ready",
    lastLocalScanAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    lastSyncedAt: null,
  },
  worktree: {
    id: "wt-1",
    repositoryId: "repo-a",
    name: "codex-ui",
    path: "/Users/example/agentic-worktrees/.worktrees/codex-ui",
    branchName: "feat/codex-ui",
    kind: "linked" as const,
    baseBranchName: "main",
    headCommitSha: null,
    status: "ready" as const,
    activeRunId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    lastSyncedAt: null,
  },
};

const installation: CodingAgentInstallationStatusDto = {
  kind: "opencode",
  name: "OpenCode",
  configured: true,
  version: "1.0.0",
  executablePath: "/usr/local/bin/opencode",
  running: true,
  error: null,
};

const createSession = vi.fn();
const sendMessage = vi.fn();
const listWorktreeModels = vi.fn();
const listWorktree = vi.fn();
const listCapabilities = vi.fn();
const capabilityChanged = vi.fn();
const locationProbe = vi.fn();
const locationStateProbe = vi.fn();

const LocationProbe = () => {
  const location = useLocation();
  locationProbe(location.pathname);
  locationStateProbe(location.state);
  return null;
};

const renderLanding = (
  props: Partial<React.ComponentProps<typeof NewThreadView>> = {},
) =>
  render(
    <MemoryRouter initialEntries={["/chat"]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <NewThreadView
                contexts={[context]}
                installations={[installation]}
                sessions={[]}
                {...props}
              />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );

const waitForModelPicker = async () => {
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Provider and model" }).textContent,
    ).toContain("·"),
  );
};

beforeEach(() => {
  createSession.mockReset();
  sendMessage.mockReset();
  sendMessage.mockResolvedValue(undefined);
  listWorktreeModels.mockReset();
  listWorktreeModels.mockImplementation(({ agentKind }) =>
    Promise.resolve([
      {
        providerId: agentKind === "codex" ? "openai" : "anthropic",
        providerName: agentKind === "codex" ? "OpenAI" : "Anthropic",
        modelId: agentKind === "codex" ? "gpt-5.4" : "claude-sonnet",
        modelName: agentKind === "codex" ? "GPT-5.4" : "Claude Sonnet",
        reasoningVariants: [],
        isDefault: true,
      },
    ]),
  );
  locationProbe.mockReset();
  locationStateProbe.mockReset();
  createSession.mockResolvedValue({ id: "run-new", worktreeId: "wt-1" });
  listWorktree.mockReset();
  listWorktree.mockResolvedValue([]);
  listCapabilities.mockReset();
  listCapabilities.mockResolvedValue([]);
  capabilityChanged.mockReset();
  capabilityChanged.mockReturnValue(() => undefined);
  Object.defineProperty(window, "api", {
    configurable: true,
    value: {
      codingAgent: { createSession, sendMessage, listWorktreeModels },
      capabilities: {
        listWorktree,
        list: listCapabilities,
        onChanged: capabilityChanged,
      },
    },
  });
});

afterEach(() => {
  cleanup();
});

describe("NewThreadView", () => {
  it("groups workspace, branch and capabilities beneath the composer", () => {
    renderLanding();
    const toolbar = screen.getByRole("group", { name: "Workspace context" });
    expect(within(toolbar).getByRole("button", { name: "Current checkout" })).toBeTruthy();
    expect(within(toolbar).getByText("feat/codex-ui")).toBeTruthy();
    expect(screen.getAllByText("feat/codex-ui")).toHaveLength(1);
    const capabilities = within(toolbar).getByRole("button", { name: /Capabilities/ });
    fireEvent.click(capabilities);
    expect(capabilities.getAttribute("aria-expanded")).toBe("true");
    const surface = screen.getByRole("textbox", { name: "Message to agent" }).closest(".session-composer__surface");
    expect(surface?.nextElementSibling).toBe(toolbar);
    expect(screen.queryByText("Enter to send · Shift + Enter for newline")).toBeNull();
  });

  it("writes into a worktree before any session exists", () => {
    renderLanding();

    expect(
      screen.getByRole("heading", {
        name: /What should we build in feat\/codex-ui/,
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("textbox", { name: "Message to agent" }),
    ).toBeTruthy();
    expect(createSession).not.toHaveBeenCalled();
    expect(locationProbe).not.toHaveBeenCalledWith(
      expect.stringContaining("/chat/wt-1/"),
    );
  });

  it("creates the session on the first send and opens the thread", async () => {
    renderLanding();
    await waitForModelPicker();

    fireEvent.change(
      screen.getByRole("textbox", { name: "Message to agent" }),
      {
        target: { value: "Make the sidebar denser" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(1));
    expect(createSession).toHaveBeenCalledWith({
      agentKind: "opencode",
      worktreeId: "wt-1",
      title: "codex-ui",
      providerId: "anthropic",
      modelId: "claude-sonnet",
    });
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith({
      runId: "run-new",
      content: "Make the sidebar denser",
    }));
    await waitFor(() =>
      expect(locationProbe).toHaveBeenCalledWith("/chat/wt-1/run-new"),
    );
  });

  it("reuses an existing draft on the same worktree instead of creating another", async () => {
    renderLanding({
      sessions: [
        {
          id: "run-draft",
          worktreeId: "wt-1",
          updatedAt: new Date(),
          isDraft: true,
          agentKind: "opencode",
          providerId: "anthropic",
          modelId: "claude-sonnet",
        },
      ],
    });

    await waitForModelPicker();
    fireEvent.change(
      screen.getByRole("textbox", { name: "Message to agent" }),
      {
        target: { value: "Continue" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() =>
      expect(locationProbe).toHaveBeenCalledWith("/chat/wt-1/run-draft"),
    );
    expect(createSession).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith({
      runId: "run-draft",
      content: "Continue",
    });
  });

  it("waits for submission before opening the thread and ignores repeated sends", async () => {
    let finishSend!: () => void;
    sendMessage.mockReturnValue(new Promise<void>((resolve) => { finishSend = resolve; }));
    renderLanding();
    await waitForModelPicker();
    const input = screen.getByRole("textbox", { name: "Message to agent" });
    fireEvent.change(input, { target: { value: "  Make the sidebar denser  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    expect(sendMessage).toHaveBeenCalledWith({ runId: "run-new", content: "Make the sidebar denser" });
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(locationProbe).not.toHaveBeenCalledWith("/chat/wt-1/run-new");
    expect(screen.getByText("Make the sidebar denser").closest("article")).toBeTruthy();
    finishSend();
    await waitFor(() => expect(locationProbe).toHaveBeenCalledWith("/chat/wt-1/run-new"));
    expect(locationStateProbe).toHaveBeenLastCalledWith({ landingSubmission: {
      runId: "run-new",
      agentName: "OpenCode",
      message: expect.objectContaining({ role: "user", content: "Make the sidebar denser" }),
    } });
  });

  it("preserves the message after a send failure and retries the same session", async () => {
    sendMessage.mockRejectedValueOnce(new Error("Could not send message."));
    renderLanding();
    await waitForModelPicker();
    const input = screen.getByRole("textbox", { name: "Message to agent" });
    fireEvent.change(input, { target: { value: "Make the sidebar denser" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Could not send message."));
    expect((input as HTMLTextAreaElement).value).toBe("Make the sidebar denser");
    expect(locationProbe).not.toHaveBeenCalledWith("/chat/wt-1/run-new");
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(locationProbe).toHaveBeenCalledWith("/chat/wt-1/run-new"));
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenLastCalledWith({ runId: "run-new", content: "Make the sidebar denser" });
  });

  it("does not create or send an empty message through the keyboard", async () => {
    renderLanding();
    await waitForModelPicker();
    const input = screen.getByRole("textbox", { name: "Message to agent" });
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(createSession).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("displays the submitted message before session creation finishes", async () => {
    createSession.mockReturnValue(new Promise(() => undefined));
    renderLanding();
    await waitForModelPicker();
    fireEvent.change(screen.getByRole("textbox", { name: "Message to agent" }), {
      target: { value: "Show this immediately" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(screen.getByText("Show this immediately").closest("article")).toBeTruthy();
    expect(screen.queryByText("Sending…")).toBeNull();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("does not reuse a draft belonging to another worktree", async () => {
    renderLanding({
      sessions: [
        {
          id: "run-other",
          worktreeId: "wt-other",
          updatedAt: new Date(),
          isDraft: true,
        },
      ],
    });

    await waitForModelPicker();
    fireEvent.change(
      screen.getByRole("textbox", { name: "Message to agent" }),
      {
        target: { value: "Continue" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(1));
    expect(createSession.mock.calls[0]?.[0]).toMatchObject({
      worktreeId: "wt-1",
    });
  });

  it("honours a worktree requested through the query string", () => {
    renderLanding({ initialWorktreeId: "wt-1" });
    expect(
      screen.getByRole("button", { name: "Current checkout" }).textContent,
    ).toContain("codex-ui");
  });

  it("keeps the draft and reports the failure when creation is rejected", async () => {
    createSession.mockRejectedValue(new Error("Codex server stopped."));
    renderLanding();
    await waitForModelPicker();

    fireEvent.change(
      screen.getByRole("textbox", { name: "Message to agent" }),
      {
        target: { value: "Make the sidebar denser" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Codex server stopped.",
      ),
    );
    expect(
      (
        screen.getByRole("textbox", {
          name: "Message to agent",
        }) as HTMLTextAreaElement
      ).value,
    ).toBe("Make the sidebar denser");
  });

  it("creates with the harness chosen in the chip, not the default one", async () => {
    const codex: CodingAgentInstallationStatusDto = {
      kind: "codex",
      name: "Codex",
      configured: true,
      version: "1.0.0",
      executablePath: "/usr/local/bin/codex",
      running: true,
      error: null,
    };
    renderLanding({ installations: [installation, codex] });

    await waitForModelPicker();
    fireEvent.click(screen.getByRole("button", { name: "Provider and model" }));
    fireEvent.click(screen.getByRole("option", { name: /Codex/ }));
    fireEvent.click(screen.getByRole("option", { name: /GPT-5.4/ }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "Message to agent" }),
      {
        target: { value: "Continue" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(1));
    expect(createSession.mock.calls[0]?.[0]).toMatchObject({
      agentKind: "codex",
      providerId: "openai",
      modelId: "gpt-5.4",
    });
  });

  it("keeps the harness and model picker on the landing", async () => {
    renderLanding({
      installations: [
        installation,
        {
          kind: "codex",
          name: "Codex",
          configured: true,
          version: "1.0.0",
          executablePath: "/usr/local/bin/codex",
          running: true,
          error: null,
        },
      ],
    });

    await waitForModelPicker();
    fireEvent.click(screen.getByRole("button", { name: "Provider and model" }));
    expect(screen.getByRole("listbox", { name: "Provider and model" })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Codex/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: /OpenCode/ }));
    expect(screen.getByRole("option", { name: /Claude Sonnet/ })).toBeTruthy();
    expect(createSession).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { name: /What should we build in/ }),
    ).toBeTruthy();
  });

  it("sends to Worktrees when there is no repository to work in", () => {
    renderLanding({ contexts: [] });

    expect(
      screen.getByRole("heading", { name: "No repositories yet" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Worktrees" }));
    expect(locationProbe).toHaveBeenCalledWith("/worktrees");
  });

  it("sends to Settings when no coding agent is configured", () => {
    renderLanding({
      installations: [{ ...installation, configured: false }],
    });

    expect(
      screen.getByRole("heading", { name: "Configure a coding agent first" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("textbox", { name: "Message to agent" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open Settings" }));
    expect(locationProbe).toHaveBeenCalledWith("/settings");
  });
});
