// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { CodingAgentSession } from "./CodingAgentSession";

const { sessionHook } = vi.hoisted(() => ({ sessionHook: vi.fn() }));
vi.mock("../hooks/useCodingAgentSession", () => ({ useCodingAgentSession: sessionHook }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

const renderSubmitted = () => render(
  <MemoryRouter initialEntries={[{
    pathname: "/chat/wt-1/run-1",
    state: { landingSubmission: {
      runId: "run-1", agentName: "Codex",
      message: { id: "pending", role: "user", content: "Show this immediately", reasoning: "", tools: [], createdAt: 1, completedAt: null },
    } },
  }]}>
    <CodingAgentSession runId="run-1" />
  </MemoryRouter>,
);

describe("first message display", () => {
  it("keeps the submitted bubble visible while the first snapshot is loading", () => {
    sessionHook.mockReturnValue({ loading: true });
    renderSubmitted();
    expect(screen.getByText("Show this immediately").closest("article")).toBeTruthy();
  });

  it("preserves the bubble and offers a read-only retry if loading fails", () => {
    const load = vi.fn();
    sessionHook.mockReturnValue({ loading: false, error: "Could not load chat", load });
    renderSubmitted();
    expect(screen.getByText("Show this immediately").closest("article")).toBeTruthy();
    expect(screen.getByText("Could not load chat")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry loading chat" }));
    expect(load).toHaveBeenCalledTimes(1);
  });
});
