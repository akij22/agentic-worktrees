import { describe, expect, it } from "vitest";
import type { CodingAgentDiffDto } from "../../../../shared/ipc/schemas";
import {
  isBusyLikeStatus,
  nextChangesSummaryUpdate,
} from "./changes-summary";

const diff: CodingAgentDiffDto[] = [
  {
    file: "src/main/app.ts",
    before: "old",
    after: "new",
    additions: 12,
    deletions: 3,
  },
];

const snapshot = (
  overrides: Partial<{
    status: string;
    diff: CodingAgentDiffDto[];
    agentFinished: boolean;
  }> = {},
) => ({
  status: "idle",
  diff,
  agentFinished: true,
  ...overrides,
});

describe("isBusyLikeStatus", () => {
  it.each(["busy", "creating", "aborting"])("treats %s as busy-like", (status) => {
    expect(isBusyLikeStatus(status)).toBe(true);
  });

  it.each(["idle", "waiting_permission", "error", "unavailable"])(
    "does not treat %s as busy-like",
    (status) => {
      expect(isBusyLikeStatus(status)).toBe(false);
    },
  );
});

describe("nextChangesSummaryUpdate", () => {
  it("shows the summary when an armed session finishes with changes", () => {
    expect(
      nextChangesSummaryUpdate(true, snapshot({ status: "idle" })),
    ).toEqual({ kind: "completed", diff });
  });

  it("shows the summary even when the run status is stuck on busy", () => {
    // The idle SSE event can be missed, leaving the status busy-like forever;
    // the completed final assistant message is the ground truth.
    expect(
      nextChangesSummaryUpdate(true, snapshot({ status: "busy" })),
    ).toEqual({ kind: "completed", diff });
    expect(
      nextChangesSummaryUpdate(true, snapshot({ status: "creating" })),
    ).toEqual({ kind: "completed", diff });
  });

  it("stays armed when the finished snapshot has no diff yet", () => {
    // The diff endpoint can lag behind completion; dismissing the armed state
    // here is what hid the panel in the first implementation.
    expect(
      nextChangesSummaryUpdate(true, snapshot({ diff: [] })),
    ).toEqual({ kind: "unchanged" });
  });

  it("does not show the summary for an already finished session that was never armed", () => {
    expect(nextChangesSummaryUpdate(false, snapshot())).toEqual({
      kind: "unchanged",
    });
  });

  it.each(["busy", "creating", "aborting"])(
    "re-arms and hides the summary while the agent is working (%s)",
    (status) => {
      const working = snapshot({ status, agentFinished: false });
      expect(nextChangesSummaryUpdate(false, working)).toEqual({
        kind: "working",
      });
      expect(nextChangesSummaryUpdate(true, working)).toEqual({
        kind: "working",
      });
    },
  );

  it("does not arm on finished snapshots, even when busy-like", () => {
    expect(
      nextChangesSummaryUpdate(false, snapshot({ status: "busy" })),
    ).toEqual({ kind: "unchanged" });
  });

  it("does not treat a permission pause as completion", () => {
    expect(
      nextChangesSummaryUpdate(
        true,
        snapshot({ status: "waiting_permission", agentFinished: false }),
      ),
    ).toEqual({ kind: "unchanged" });
  });

  it.each(["error", "unavailable"])(
    "does not show the summary when the session ends in %s without a completed message",
    (status) => {
      expect(
        nextChangesSummaryUpdate(
          true,
          snapshot({ status, agentFinished: false }),
        ),
      ).toEqual({ kind: "unchanged" });
    },
  );
});
