// @vitest-environment jsdom
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import {
  type AssignmentChangedEventDto,
  type AssignmentProjectionDto,
  type AssignmentIpcResult,
  type AssignmentSetDesiredRequest,
} from "../../../../shared/assignments/schemas";
import { useWorktreeResourceAssignment } from "../hooks/useWorktreeResourceAssignment";
import { WorktreeResourcePicker } from "./WorktreeResourcePicker";

import { initialProjection } from "./resource-ui-test-fixtures";

function setup(value = initialProjection(), failInitialLoad = false) {
  let current = value;
  const listeners = new Set<(event: AssignmentChangedEventDto) => void>();
  const get = vi.fn(async () => ({ ok: true as const, value: current }));
  const setDesired = vi.fn<
    (
      request: AssignmentSetDesiredRequest,
    ) => Promise<AssignmentIpcResult<AssignmentProjectionDto>>
  >(async () => ({ ok: true, value: current }));
  if (failInitialLoad) get.mockRejectedValueOnce(new Error("private cause"));
  const api = {
    get,
    setDesired,
    retry: vi.fn(async () => ({ ok: true as const, value: current })),
    cancelPending: vi.fn(async () => ({ ok: true as const, value: current })),
    recover: vi.fn(async () => ({ ok: true as const, value: current })),
    onChanged: (listener: (event: AssignmentChangedEventDto) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  Object.defineProperty(window, "api", {
    configurable: true,
    value: { resourceAssignment: api },
  });
  function Subject() {
    const assignment = useWorktreeResourceAssignment("wt", "codex");
    return (
      <WorktreeResourcePicker assignment={assignment} onStopSession={vi.fn()} />
    );
  }
  const stop = vi.fn(),
    marketplace = vi.fn();
  function WithStop() {
    const assignment = useWorktreeResourceAssignment("wt", "codex");
    return (
      <WorktreeResourcePicker
        assignment={assignment}
        onStopSession={stop}
        onOpenMarketplace={marketplace}
      />
    );
  }
  const view = render(<WithStop />);
  const publish = (next: AssignmentProjectionDto) => {
    current = next;
    act(() =>
      listeners.forEach((listener) =>
        listener({
          eventId: `event-${next.projectionSequence}`,
          worktreeId: "wt",
          revision: next.revision,
          projectionSequence: next.projectionSequence,
          projection: next,
        }),
      ),
    );
  };
  return {
    view,
    user: userEvent.setup(),
    api,
    publish,
    stop,
    marketplace,
    Subject,
  };
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("leaves initial loading after a failed fetch and offers a bounded error and successful Retry", async () => {
  const { user } = setup(initialProjection(), true);
  expect(
    screen.getByRole("button", { name: "Resources, Loading…" }),
  ).toBeTruthy();
  await user.click(
    await screen.findByRole("button", { name: "Resources, Unavailable" }),
  );
  const popup = screen.getByRole("dialog", {
    name: "Resources for this worktree",
  });
  expect(popup.getAttribute("aria-busy")).toBe("false");
  expect(screen.queryByText(/private cause/)).toBeNull();
  await user.click(
    screen.getByRole("button", { name: "Retry loading resources" }),
  );
  expect(
    await screen.findByRole("button", { name: "Resources, 1 enabled" }),
  ).toBeTruthy();
});
it("focuses the group after a conflict updates the Resource version, and does not replay the old selection", async () => {
  const { user, api } = setup();
  await user.click(
    await screen.findByRole("button", { name: "Resources, 1 enabled" }),
  );
  const next = initialProjection();
  next.revision = "5";
  next.projectionSequence = "9";
  next.resources[1] = { ...next.resources[1], version: "3.0" };
  api.setDesired.mockResolvedValueOnce({
    ok: false,
    error: {
      code: "assignment_conflict",
      message: "Changed elsewhere",
      retryable: true,
      current: next,
    },
  });
  await user.click(screen.getByRole("checkbox", { name: "URL Fetch" }));
  expect(document.activeElement).toBe(
    screen.getByRole("heading", { name: "Assigned" }),
  );
  expect(
    screen.getByText("The resource changed. Review the latest selection."),
  ).toBeTruthy();
  expect(api.setDesired).toHaveBeenCalledTimes(1);
});
it("removes desired membership without deleting history, labels queued edits, and protects refreshed revisions after a sequence gap", async () => {
  const { user, api, publish } = setup();
  await user.click(
    await screen.findByRole("button", { name: "Resources, 1 enabled" }),
  );
  expect(
    screen.getByText("Removing an assignment preserves past activity."),
  ).toBeTruthy();
  const applying = {
    ...initialProjection(),
    phase: "applying" as const,
    projectionSequence: "12",
    revision: "5",
  };
  let finish: (value: {
    ok: true;
    value: AssignmentProjectionDto;
  }) => void = () => undefined;
  api.get.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  publish(applying);
  expect(
    screen
      .getByRole("checkbox", { name: "Security Review" })
      .hasAttribute("disabled"),
  ).toBe(true);
  await act(async () => finish({ ok: true, value: applying }));
  expect(screen.getByText("Queued after current change.")).toBeTruthy();
  await user.click(screen.getByRole("checkbox", { name: "Security Review" }));
  expect(api.setDesired).toHaveBeenCalledWith({
    worktreeId: "wt",
    expectedRevision: "5",
    resources: [],
  });
});
it("opens one worktree control by keyboard, submits a complete set without optimistic Enabled, and restores focus", async () => {
  const { user, api, publish } = setup();
  const trigger = await screen.findByRole("button", {
    name: "Resources, 1 enabled",
  });
  trigger.focus();
  await user.keyboard("{Enter}");
  const popup = await screen.findByRole("dialog", {
    name: "Resources for this worktree",
  });
  expect(
    within(popup).getByText("Changes apply to every session in this worktree."),
  ).toBeTruthy();
  expect(within(popup).getByRole("heading", { name: "Assigned" })).toBeTruthy();
  expect(
    within(popup).getByRole("heading", { name: "Available" }),
  ).toBeTruthy();
  const checkbox = within(popup).getByRole("checkbox", { name: "URL Fetch" });
  let resolve: (value: {
    ok: true;
    value: AssignmentProjectionDto;
  }) => void = () => undefined;
  api.setDesired.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  checkbox.focus();
  await user.keyboard(" ");
  expect(api.setDesired).toHaveBeenCalledWith({
    worktreeId: "wt",
    expectedRevision: "4",
    resources: [
      { kind: "skill", id: "review", version: "1.0" },
      { kind: "capability", id: "fetch", version: "2.0" },
    ],
  });
  expect((checkbox as HTMLInputElement).checked).toBe(false);
  expect(checkbox.getAttribute("aria-busy")).toBe("true");
  const applying = initialProjection();
  applying.revision = "5";
  applying.projectionSequence = "9";
  applying.phase = "applying";
  applying.resources[1] = {
    ...applying.resources[1],
    desired: true,
    operation: "adding",
    status: "applying",
  };
  await act(async () => resolve({ ok: true, value: applying }));
  expect(
    await within(popup).findByText("Applying", { selector: "span" }),
  ).toBeTruthy();
  const stable = {
    ...applying,
    phase: "stable" as const,
    projectionSequence: "10",
    resources: applying.resources.map((item) => ({
      ...item,
      verified: true,
      status: "enabled" as const,
      operation: null,
    })),
  };
  publish(stable);
  expect(
    screen.getByRole("button", { name: "Resources, 2 enabled" }),
  ).toBeTruthy();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(trigger);
});
it("keeps provider-unavailable assignment checked, setup outside assignment, and honest Codex isolation copy", async () => {
  const value = initialProjection();
  value.resources[0] = {
    ...value.resources[0],
    status: "unavailable",
    unavailableReason: "provider_unqualified",
  };
  value.resources[1] = {
    ...value.resources[1],
    assignable: false,
    unavailableReason: "setup_required",
  };
  const { user, api, marketplace } = setup(value);
  await user.click(
    await screen.findByRole("button", { name: "Resources, 0 enabled" }),
  );
  expect(
    (
      screen.getByRole("checkbox", {
        name: "Security Review",
      }) as HTMLInputElement
    ).checked,
  ).toBe(true);
  expect(
    screen
      .getByRole("checkbox", { name: "URL Fetch" })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(screen.getByText("Provider qualification unavailable.")).toBeTruthy();
  expect(screen.getByText("Isolation not enforced")).toBeTruthy();
  expect(
    screen.getByText(
      "Codex may access other Skills outside this worktree Assignment.",
    ),
  ).toBeTruthy();
  await user.click(
    screen.getByRole("button", { name: "Configure URL Fetch in Marketplace" }),
  );
  expect(marketplace).toHaveBeenCalledWith({ kind: "capability", id: "fetch" });
  expect(api.setDesired).not.toHaveBeenCalled();
});
it("announces waiting blockers, keeps exact Stop and revisioned Cancel reachable, and withdraws cancel once applying", async () => {
  const waiting = initialProjection();
  waiting.phase = "waiting_for_idle";
  waiting.allowedActions = ["cancel_pending"];
  waiting.blockers = [
    {
      kind: "active_turn",
      sessionRunId: "run-other",
      sessionTitle: "Fix auth",
      canStop: true,
    },
  ];
  const { user, api, publish, stop } = setup(waiting);
  await user.click(
    await screen.findByRole("button", { name: "Resources, Waiting…" }),
  );
  expect(screen.getByRole("status").textContent).toContain(
    "Waiting for active sessions before applying resource changes.",
  );
  await user.click(
    screen.getByRole("button", { name: "Stop agent: Fix auth" }),
  );
  expect(stop).toHaveBeenCalledWith("run-other");
  await user.click(screen.getByRole("button", { name: "Cancel change" }));
  expect(api.cancelPending).toHaveBeenCalledWith({
    worktreeId: "wt",
    expectedRevision: "4",
  });
  publish({
    ...waiting,
    phase: "applying",
    projectionSequence: "9",
    allowedActions: [],
    progress: { step: "verifying", completed: 1, total: 2, waitingSince: null },
  });
  expect(screen.queryByRole("button", { name: "Cancel change" })).toBeNull();
  expect(screen.getByRole("status").textContent).toContain(
    "Verifying · 1 of 2",
  );
});

it("handles empty, failed fetch and stale snapshots with explicit Retry rather than usable stale controls", async () => {
  const value = initialProjection();
  value.resources = [];
  const { user, api, publish } = setup(value);
  await user.click(
    await screen.findByRole("button", { name: "Resources, 0 enabled" }),
  );
  expect(
    screen.getByText(
      "No resources installed. Install resources in Marketplace.",
    ),
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: "Open Marketplace" })).toBeTruthy();
  api.get.mockRejectedValueOnce(new Error("private failure"));
  act(() => window.dispatchEvent(new Event("focus")));
  expect(
    await screen.findByText(
      "Worktree resources could not be loaded. Try again.",
    ),
  ).toBeTruthy();
  expect(
    screen.getByText(
      "Resource information is stale. Refresh before sending or making changes.",
    ),
  ).toBeTruthy();
  await user.click(
    screen.getByRole("button", { name: "Retry loading resources" }),
  );
  await waitFor(() =>
    expect(
      screen.queryByText(
        "Resource information is stale. Refresh before sending or making changes.",
      ),
    ).toBeNull(),
  );
  publish({ ...initialProjection(), projectionSequence: "9" });
  expect(
    screen
      .getByRole("checkbox", { name: "URL Fetch" })
      .hasAttribute("disabled"),
  ).toBe(false);
});
it("replaces a stale conflict without replaying, preserves search and focus, and converges two windows", async () => {
  const value = initialProjection();
  for (let index = 0; index < 10; index++)
    value.resources.push({
      ...value.resources[1],
      id: `tool-${index}`,
      name: `Tool ${index}`,
    });
  const { user, api, publish, Subject } = setup(value);
  render(<Subject />);
  const triggers = await screen.findAllByRole("button", {
    name: "Resources, 1 enabled",
  });
  await user.click(triggers[0]);
  const search = screen.getByRole("searchbox", { name: "Search resources" });
  await user.type(search, "Fetch");
  const next = {
    ...value,
    revision: "5",
    projectionSequence: "9",
    resources: value.resources.map((item) =>
      item.id === "fetch"
        ? { ...item, desired: true, verified: true, status: "enabled" as const }
        : item,
    ),
  };
  api.setDesired.mockResolvedValueOnce({
    ok: false,
    error: {
      code: "assignment_conflict",
      message: "Changed elsewhere",
      retryable: true,
      current: next,
    },
  });
  const checkbox = screen.getByRole("checkbox", { name: "URL Fetch" });
  await user.click(checkbox);
  expect(screen.getByRole("alert").textContent).toContain(
    "Resources changed in another window. Review the latest selection and try again.",
  );
  expect((search as HTMLInputElement).value).toBe("Fetch");
  expect(document.activeElement).toBe(
    screen.getByRole("checkbox", { name: "URL Fetch" }),
  );
  expect(api.setDesired).toHaveBeenCalledTimes(1);
  publish(next);
  expect(
    screen.getAllByRole("button", { name: "Resources, 2 enabled" }),
  ).toHaveLength(2);
  publish(value);
  expect(
    screen.getAllByRole("button", { name: "Resources, 2 enabled" }),
  ).toHaveLength(2);
});
it("shows verified rollback and revisioned Retry/Discard, then only advertised recovery actions and removal lock", async () => {
  const failed = initialProjection();
  failed.phase = "failed_rolled_back";
  failed.allowedActions = ["retry"];
  failed.resources[1] = {
    ...failed.resources[1],
    desired: true,
    status: "failed",
  };
  const { user, api, publish } = setup(failed);
  await user.click(
    await screen.findByRole("button", { name: "Resources, Failed" }),
  );
  expect(screen.getByRole("alert").textContent).toContain(
    "Your previous verified setup is still active.",
  );
  await user.click(screen.getByRole("button", { name: "Retry changes" }));
  expect(api.retry).toHaveBeenCalledWith({
    worktreeId: "wt",
    expectedRevision: "4",
  });
  await user.click(screen.getByRole("button", { name: "Discard changes" }));
  expect(api.setDesired).toHaveBeenCalledWith({
    worktreeId: "wt",
    expectedRevision: "4",
    resources: [{ kind: "skill", id: "review", version: "1.0" }],
  });
  const recovery = {
    ...failed,
    phase: "recovery_required" as const,
    projectionSequence: "9",
    allowedActions: ["retry_recovery" as const],
  };
  publish(recovery);
  expect(screen.getByRole("alert").textContent).toContain(
    "Agent actions are paused",
  );
  expect(
    screen
      .getAllByRole("checkbox")
      .every((input) => input.hasAttribute("disabled")),
  ).toBe(true);
  expect(
    screen.queryByRole("button", { name: "Recreate affected runtime" }),
  ).toBeNull();
  await user.click(screen.getByRole("button", { name: "Retry recovery" }));
  expect(api.recover).toHaveBeenCalledWith({
    worktreeId: "wt",
    expectedRevision: "4",
    action: "retry_recovery",
  });
  publish({
    ...recovery,
    phase: "removing",
    projectionSequence: "10",
    allowedActions: [],
  });
  expect(screen.queryByRole("button", { name: "Retry recovery" })).toBeNull();
  expect(screen.getByText("This worktree is being removed.")).toBeTruthy();
});
