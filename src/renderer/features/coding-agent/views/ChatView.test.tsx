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
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useParams,
} from "react-router-dom";
import { ChatView } from "./ChatView";

const mocks = vi.hoisted(() => ({
  remove: vi.fn(),
  reload: vi.fn(async () => undefined),
}));
vi.mock("../../../components/AppNavigation", () => ({
  AppNavigation: () => null,
  AppNavigationFooter: () => null,
}));
vi.mock("./CodingAgentWorkspace", () => ({
  CodingAgentWorkspace: () => <div>Chat workspace</div>,
}));
vi.mock("./NewThreadView", () => ({
  NewThreadView: () => <div>New chat</div>,
}));
vi.mock("../hooks/useCodingAgentSessions", () => ({
  useCodingAgentSessions: () => ({
    status: undefined,
    contexts: [],
    loading: false,
    error: undefined,
    sessionDetails: new Map(),
    reload: mocks.reload,
    sessions: ["one", "two"].map((id) => ({
      id,
      title: `Chat ${id}`,
      agentKind: "codex",
      agentName: "Codex",
      repositoryId: "repo",
      worktreeId: "wt",
      status: "idle",
      errorMessage: null,
      hasUnviewedChanges: false,
      providerId: "openai",
      modelId: "gpt",
      createdAt: new Date(0),
      updatedAt: new Date(0),
    })),
  }),
}));
const Surface = () => {
  const { runId } = useParams();
  const location = useLocation();
  return (
    <>
      <output aria-label="Current route">{location.pathname}</output>
      <ChatView activeRunId={runId} />
    </>
  );
};
beforeEach(() => {
  mocks.remove.mockReset().mockResolvedValue({ success: true });
  mocks.reload.mockClear();
  Object.defineProperty(window, "api", {
    configurable: true,
    value: {
      codingAgent: {
        deleteSession: mocks.remove,
        showSessionContextMenu: vi.fn(async () => ({
          success: true,
          action: "delete",
        })),
      },
    },
  });
});
afterEach(cleanup);
const deleteChat = async (title: string) => {
  fireEvent.contextMenu(
    screen.getByRole("button", { name: new RegExp(title) }),
  );

  fireEvent.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", {
      name: "Delete chat",
    }),
  );
};
const renderSurface = () =>
  render(
    <MemoryRouter initialEntries={["/chat/wt/one"]}>
      <Routes>
        <Route path="/chat" element={<Surface />} />
        <Route path="/chat/:worktreeId/:runId" element={<Surface />} />
      </Routes>
    </MemoryRouter>,
  );

describe("chat deletion navigation", () => {
  it("returns to new chat and refreshes the list after deleting the open chat", async () => {
    renderSurface();
    await deleteChat("Chat one");
    await waitFor(() =>
      expect(screen.getByLabelText("Current route").textContent).toBe("/chat"),
    );
    expect(screen.getByText("New chat")).toBeTruthy();
    expect(mocks.reload).toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalledWith({ runId: "one" });
  });
  it("preserves the current route after deleting another chat", async () => {
    renderSurface();
    await deleteChat("Chat two");
    await waitFor(() => expect(mocks.reload).toHaveBeenCalled());
    expect(screen.getByLabelText("Current route").textContent).toBe(
      "/chat/wt/one",
    );
    expect(mocks.remove).toHaveBeenCalledWith({ runId: "two" });
  });
  it("shows errors without navigating or refreshing", async () => {
    mocks.remove.mockResolvedValue({
      success: false,
      error: {
        code: "SESSION_ACTIVE",
        message: "Stop the active response first.",
      },
    });
    renderSurface();
    await deleteChat("Chat one");
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Stop the active response first.",
    );
    expect(screen.getByLabelText("Current route").textContent).toBe(
      "/chat/wt/one",
    );
    expect(mocks.reload).not.toHaveBeenCalled();
  });
});
