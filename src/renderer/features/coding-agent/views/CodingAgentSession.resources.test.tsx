// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { codingAgentSessionSnapshotSchema } from "../../../../shared/ipc/schemas";
import { initialProjection } from "../../resources/components/resource-ui-test-fixtures";
import { CodingAgentSession } from "./CodingAgentSession";

afterEach(cleanup);
it("retains a Skill and arguments through rejection, clears them only after acceptance, and has no second activation control", async () => {
  const skill = {
    id: "review",
    name: "Security Review",
    description: "Review changes",
    version: "1.0",
    source: "local",
    installationState: "installed",
    compatibility: { codex: "supported", opencode: "supported" },
    automaticInvocation: true,
  };
  const snapshot = codingAgentSessionSnapshotSchema.parse({
    session: {
      id: "run",
      worktreeId: "wt",
      repositoryId: "repo",
      agentKind: "codex",
      agentName: "Codex",
      title: "Review auth",
      status: "idle",
      errorMessage: null,
      hasUnviewedChanges: false,
      providerId: "openai",
      modelId: "gpt",
      createdAt: new Date(0),
      updatedAt: new Date(0),
    },
    context: {
      repository: { name: "App", fullName: "org/app" },
      worktree: {
        id: "wt",
        name: "Auth fix",
        path: "/local/app",
        branchName: "fix-auth",
      },
    },
    messages: [],
    diff: [],
    turnDiff: [],
    capabilities: [
      {
        id: "old",
        name: "Old capability",
        version: "1",
        state: "active",
        activatedAt: "2026-10-03T10:00:00.000Z",
      },
    ],
    skillInvocations: [
      {
        id: "old-skill",
        skillId: "old",
        name: "Old Skill",
        version: "1",
        mode: "explicit",
        status: "loaded",
        requestedAt: "2026-10-03T10:00:00.000Z",
      },
    ],
  });
  const sendMessage = vi.fn();
  let accept: () => void = () => undefined;
  sendMessage
    .mockImplementationOnce(() =>
      Promise.reject(new Error("private /path provider failure")),
    )
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          accept = resolve;
        }),
    );
  Object.defineProperty(window, "api", {
    configurable: true,
    value: {
      codingAgent: {
        getSession: async () => snapshot,
        markSessionViewed: async () => undefined,
        onEvent: () => () => undefined,
        listModels: async () => [],
        getSessionUsage: async () => ({
          contextTokens: 0,
          contextWindow: 100,
          contextPercentage: 0,
          totalCost: null,
          providerId: "openai",
          modelId: "gpt",
        }),
        sendMessage,
      },
      skills: { list: async () => [skill], onChanged: () => () => undefined },
      resourceAssignment: {
        get: async () => ({ ok: true, value: initialProjection() }),
        onChanged: () => () => undefined,
      },
      resourceActivity: {
        list: async () => ({
          ok: true,
          value: { runId: "run", sequence: "0", items: [] },
        }),
        onChanged: () => () => undefined,
      },
      editors: { listAvailable: async () => [] },
      workspace: { files: { search: async () => [] } },
    },
  });
  render(
    <MemoryRouter>
      <CodingAgentSession runId="run" showInspection={false} />
    </MemoryRouter>,
  );
  const user = userEvent.setup(),
    editor = await screen.findByRole("textbox", { name: "Message to agent" });
  await screen.findByRole("button", { name: "Resources, 1 enabled" });
  expect(screen.queryByText(/Loaded skill|activated/)).toBeNull();
  await user.click(screen.getByRole("button", { name: "Session details" }));
  expect(
    screen.queryByRole("button", { name: /Remove Old capability/ }),
  ).toBeNull();
  await user.keyboard("{Escape}");
  await user.type(editor, "/skill:review Check auth");
  await user.keyboard("{Enter}");
  await user.click(screen.getByRole("button", { name: "Send message" }));
  expect(
    await screen.findByText(
      "The agent did not accept the message. Your draft has been kept. Try again.",
    ),
  ).toBeTruthy();
  expect((editor as HTMLTextAreaElement).value).toBe("Check auth");
  expect(
    screen.getByRole("button", { name: "Remove Security Review skill" }),
  ).toBeTruthy();
  expect(screen.queryByText(/private/)).toBeNull();
  await user.click(screen.getByRole("button", { name: "Send message" }));
  expect((editor as HTMLTextAreaElement).value).toBe("Check auth");
  expect(sendMessage).toHaveBeenLastCalledWith({
    runId: "run",
    skillInvocation: {
      skillId: "review",
      version: "1.0",
      arguments: "Check auth",
    },
  });
  accept();
  await waitFor(() => expect((editor as HTMLTextAreaElement).value).toBe(""));
  expect(
    screen.queryByRole("button", { name: "Remove Security Review skill" }),
  ).toBeNull();
});
