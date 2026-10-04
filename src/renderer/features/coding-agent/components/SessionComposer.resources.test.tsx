// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import type { SkillSummaryDto } from "../../../../shared/skills/schemas";
import { afterEach, expect, it, vi } from "vitest";
import type { CodingAgentSessionDto } from "../../../../shared/ipc/schemas";
import type {
  AssignmentChangedEventDto,
  AssignmentProjectionDto,
} from "../../../../shared/assignments/schemas";
import { initialProjection } from "../../resources/components/resource-ui-test-fixtures";
import { SessionComposer } from "./SessionComposer";

const session: CodingAgentSessionDto = {
  id: "run",
  worktreeId: "wt",
  repositoryId: "repo",
  agentKind: "codex",
  agentName: "Codex",
  title: "Review",
  status: "idle",
  providerId: "openai",
  modelId: "gpt",
  errorMessage: null,
  hasUnviewedChanges: false,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};
const review: SkillSummaryDto = {
  id: "review",
  name: "Security Review",
  description: "Review changes",
  version: "1.0",
  source: "local",
  installationState: "installed",
  compatibility: { codex: "supported", opencode: "supported" },
  automaticInvocation: true,
};
function setup() {
  let projection = initialProjection();
  const listeners = new Set<(event: AssignmentChangedEventDto) => void>();
  const send = vi.fn(),
    stop = vi.fn();
  Object.defineProperty(window, "api", {
    configurable: true,
    value: {
      resourceAssignment: {
        get: async () => ({ ok: true, value: projection }),
        onChanged: (listener: (event: AssignmentChangedEventDto) => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      workspace: { files: { search: async () => [] } },
    },
  });
  function Subject({ busy = false }: { busy?: boolean }) {
    const [draft, setDraft] = useState("Keep my draft");
    const [selectedSkill, setSelectedSkill] = useState<SkillSummaryDto>();
    return (
      <SessionComposer
        target={{kind:"session",session}}
        draft={draft}
        onDraftChange={setDraft}
        skills={[
          review,
          { ...review, id: "ambient", name: "Ambient Skill" },
          { ...review, id: "old", version: "0.1", name: "Old Skill" },
        ]}
        selectedSkill={selectedSkill}
        onSkillSelect={setSelectedSkill}
        onSkillClear={() => setSelectedSkill(undefined)}
        models={[]}
        modelKey="openai::gpt"
        reasoningVariant=""
        reasoningVariants={[]}
        loadingModels={false}
        changingModel={false}
        locked={false}
        busy={busy}
        onSend={send}
        onStop={stop}
        onSlashCommand={() => undefined}
        onModelChange={() => undefined}
        onReasoningChange={() => undefined}
      />
    );
  }
  const view = render(<Subject />);
  const publish = (next: AssignmentProjectionDto) => {
    projection = next;
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
  return { view, publish, send, stop, Subject, user: userEvent.setup() };
}
afterEach(cleanup);
it("gates Enter and Send on Assignment admission while preserving editable drafts and Stop", async () => {
  const { publish, send, stop, view, Subject, user } = setup();
  expect(
    screen
      .getByRole("button", { name: "Send message" })
      .hasAttribute("disabled"),
  ).toBe(true);
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Send message" })
        .hasAttribute("disabled"),
    ).toBe(false),
  );
  const waiting = initialProjection();
  waiting.phase = "waiting_for_idle";
  waiting.projectionSequence = "9";
  waiting.admission = {
    canCreateSession: false,
    canResumeSession: false,
    canSend: false,
    reason: "assignment_busy",
    message: "Waiting for resource changes.",
  };
  publish(waiting);
  const editor = screen.getByRole("textbox", { name: "Message to agent" });
  expect(editor.hasAttribute("disabled")).toBe(false);
  expect(
    screen
      .getByRole("button", { name: "Send message" })
      .hasAttribute("disabled"),
  ).toBe(true);
  fireEvent.keyDown(editor, { key: "Enter" });
  expect(send).not.toHaveBeenCalled();
  await user.type(editor, " intact");
  expect((editor as HTMLTextAreaElement).value).toBe("Keep my draft intact");
  view.rerender(<Subject busy />);
  await user.click(screen.getByRole("button", { name: "Stop Codex" }));
  expect(stop).toHaveBeenCalledOnce();
  publish({ ...waiting, phase: "applying", projectionSequence: "10" });
  expect((editor as HTMLTextAreaElement).value).toBe("Keep my draft intact");
  expect(
    screen.getByText(
      "Codex may access other Skills outside this worktree Assignment.",
    ),
  ).toBeTruthy();
});
it("announces recovery with the picker closed and only one progress live region when it is open", async () => {
  const { publish, user } = setup();
  await screen.findByRole("button", { name: "Resources, 1 enabled" });
  const recovery = initialProjection();
  recovery.phase = "recovery_required";
  recovery.projectionSequence = "9";
  recovery.allowedActions = ["retry_recovery"];
  recovery.admission = {
    canCreateSession: false,
    canResumeSession: false,
    canSend: false,
    reason: "recovery_required",
    message: "Agent actions are paused for this worktree.",
  };
  publish(recovery);
  expect(screen.getByRole("alert").textContent).toContain(
    "Resource state could not be verified.",
  );
  await user.click(
    screen.getByRole("button", { name: "Resources, Recovery required" }),
  );
  publish({
    ...recovery,
    phase: "rolling_back",
    projectionSequence: "10",
    allowedActions: [],
    progress: {
      step: "rolling_back",
      completed: 1,
      total: 2,
      waitingSince: null,
    },
  });
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(screen.getByRole("status").textContent).toContain(
    "Rolling back · 1 of 2",
  );
});
it("offers only verified assigned Skills and removes an invalidated chip while preserving arguments and focus", async () => {
  const { publish, user, send } = setup();
  await screen.findByRole("button", { name: "Resources, 1 enabled" });
  const editor = screen.getByRole("textbox", { name: "Message to agent" });
  await user.clear(editor);
  await user.type(editor, "/skill:");
  expect(screen.queryByRole("option", { name: /Ambient Skill/ })).toBeNull();
  expect(screen.queryByRole("option", { name: /Old Skill/ })).toBeNull();
  await user.type(editor, "review Review auth");
  await user.keyboard("{Enter}");
  expect(
    screen.getByRole("button", { name: "Remove Security Review skill" }),
  ).toBeTruthy();
  expect((editor as HTMLTextAreaElement).value).toBe("Review auth");
  const next = initialProjection();
  next.projectionSequence = "9";
  next.resources[0] = {
    ...next.resources[0],
    status: "unavailable",
    unavailableReason: "provider_incompatible",
  };
  publish(next);
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Remove Security Review skill" }),
    ).toBeNull(),
  );
  expect(screen.getByRole("status").textContent).toBe(
    "Selected Skill is no longer available in this worktree.",
  );
  expect((editor as HTMLTextAreaElement).value).toBe("Review auth");
  expect(document.activeElement).toBe(editor);
  expect(send).not.toHaveBeenCalled();
});
