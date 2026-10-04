// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type {
  SessionResourceActivityChangedEvent,
  SessionResourceActivityItem,
} from "../../../../shared/resource-activity/schemas";
import { SessionMessages } from "./SessionMessages";
const requested: SessionResourceActivityItem = {
  id: "activity",
  resourceKind: "capability",
  resourceId: "fetch",
  resourceVersion: "2.0",
  requestState: "requested",
  useState: "not_confirmed",
  lifecycle: "open",
  outcome: "not_observed",
  mode: "unknown",
  coverage: "qualified",
  occurredAt: "2026-10-03T10:00:00.000Z",
};
function setup(items = [requested]) {
  let changed: (event: SessionResourceActivityChangedEvent) => void = () =>
    undefined;
  Object.defineProperty(window, "api", {
    configurable: true,
    value: {
      resourceActivity: {
        list: async () => ({
          ok: true,
          value: { runId: "run", sequence: "1", items },
        }),
        onChanged: (listener: typeof changed) => {
          changed = listener;
          return () => undefined;
        },
      },
    },
  });
  render(
    <SessionMessages
      runId="run"
      agentName="Codex"
      messages={[]}
      busy={false}
      activity={undefined}
      permission={undefined}
      error={undefined}
      onRespondPermission={() => undefined}
    />,
  );
  return (event: SessionResourceActivityChangedEvent) =>
    act(() => changed(event));
}
afterEach(cleanup);
it("shows exact-run Requested then promotes the same item to Used/Failed and removes it on attribution conflict", async () => {
  const publish = setup();
  expect(await screen.findByText("Capability requested")).toBeTruthy();
  publish({
    eventId: "foreign",
    runId: "another-run",
    sequence: "2",
    change: {
      type: "upsert",
      item: { ...requested, id: "foreign", resourceId: "private-tool" },
    },
  });
  expect(screen.queryByText(/private-tool/)).toBeNull();
  const used = {
    ...requested,
    useState: "confirmed" as const,
    lifecycle: "terminal" as const,
    outcome: "reported_error" as const,
  };
  publish({
    eventId: "used",
    runId: "run",
    sequence: "2",
    change: { type: "upsert", item: used },
  });
  expect(screen.getByText("Capability used · Failed")).toBeTruthy();
  expect(screen.queryByText("Capability requested")).toBeNull();
  expect(screen.getAllByText("fetch · 2.0")).toHaveLength(1);
  publish({
    eventId: "removed",
    runId: "run",
    sequence: "3",
    change: { type: "remove", activityId: "activity" },
  });
  await waitFor(() =>
    expect(screen.queryByText("Capability used · Failed")).toBeNull(),
  );
});
it("distinguishes automatic qualified context entry, unknown mode, legacy request and incomplete evidence", async () => {
  setup([
    {
      ...requested,
      id: "auto",
      resourceKind: "skill",
      resourceId: "review",
      useState: "confirmed",
      mode: "automatic",
      lifecycle: "terminal",
      outcome: "success",
    },
    {
      ...requested,
      id: "unknown-mode",
      resourceKind: "skill",
      resourceId: "plan",
      useState: "confirmed",
      mode: "unknown",
      lifecycle: "terminal",
      outcome: "success",
    },
    {
      ...requested,
      id: "legacy",
      resourceKind: "skill",
      resourceId: "old",
      useState: "not_confirmed",
      coverage: "legacy_unverified",
      lifecycle: "terminal",
    },
    {
      ...requested,
      id: "gap",
      resourceKind: "skill",
      resourceId: "gap",
      useState: "not_confirmed",
      coverage: "evidence_gap",
      mode: "automatic",
    },
    {
      ...requested,
      id: "denied",
      lifecycle: "terminal",
      outcome: "permission_denied",
    },
  ]);
  expect(await screen.findByText("Skill used automatically")).toBeTruthy();
  expect(screen.getByText("Skill used")).toBeTruthy();
  expect(screen.getByText("Legacy request · Use not verified")).toBeTruthy();
  expect(screen.getByText("Skill requested · Use not verified")).toBeTruthy();
  expect(screen.getByText("Capability request denied")).toBeTruthy();
  expect(screen.getAllByText(/automatically/)).toHaveLength(1);
});
it.each([
  ["timeout", "Capability used · Timed out"],
  ["cancelled", "Capability used · Cancelled"],
  ["thrown", "Capability used · Failed"],
  ["not_observed", "Capability used · Outcome not verified"],
] as const)(
  "keeps confirmed use separate from the %s outcome",
  async (outcome, label) => {
    setup([
      {
        ...requested,
        useState: "confirmed",
        lifecycle: "terminal",
        outcome,
        coverage: outcome === "not_observed" ? "evidence_gap" : "qualified",
      },
    ]);
    expect(await screen.findByText(label)).toBeTruthy();
  },
);
