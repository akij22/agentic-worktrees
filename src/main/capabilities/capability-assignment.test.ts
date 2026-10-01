import { describe, expect, it } from "vitest";
import {
  isAvailableAssignment,
  isInheritableAssignment,
  needsMaterialisation,
  nextAssignmentStatus,
  settleAssignmentStatus,
  type WorktreeCapabilityRecord,
} from "./capability-assignment";

const record = (
  status: string,
  overrides: Partial<WorktreeCapabilityRecord> = {},
): WorktreeCapabilityRecord => ({
  worktreeId: "wt-1",
  capabilityId: "web-search",
  version: "1.0.0",
  status,
  ...overrides,
});

describe("isInheritableAssignment", () => {
  it("inherits a proven assignment into a new session", () => {
    expect(isInheritableAssignment(record("active"))).toBe(true);
  });

  it("inherits an assignment that is still applying", () => {
    expect(isInheritableAssignment(record("pending_activation"))).toBe(true);
  });

  it("does not inherit a failed, revoked or in-flight deactivation", () => {
    expect(isInheritableAssignment(record("activation_failed"))).toBe(false);
    expect(isInheritableAssignment(record("deactivated"))).toBe(false);
    expect(isInheritableAssignment(record("pending_deactivation"))).toBe(false);
  });
});

describe("isAvailableAssignment", () => {
  it("only reports a verified assignment as available", () => {
    expect(isAvailableAssignment(record("active"))).toBe(true);
    expect(isAvailableAssignment(record("pending_activation"))).toBe(false);
    expect(isAvailableAssignment(record("activation_failed"))).toBe(false);
    expect(isAvailableAssignment(undefined)).toBe(false);
  });
});

describe("needsMaterialisation", () => {
  it("reconciles a pending assignment even when no session is running", () => {
    expect(needsMaterialisation(record("pending_activation"), [])).toBe(true);
  });

  it("leaves an already active assignment alone when a session has it", () => {
    expect(needsMaterialisation(record("active"), ["run-1"])).toBe(false);
  });

  it("reconciles an active assignment when no session currently holds it", () => {
    expect(needsMaterialisation(record("active"), [])).toBe(true);
  });

  it("ignores assignments that were revoked or failed", () => {
    expect(needsMaterialisation(record("deactivated"), [])).toBe(false);
    expect(needsMaterialisation(record("activation_failed"), [])).toBe(false);
  });
});

describe("assignment transitions", () => {
  it("always starts an assignment as applying", () => {
    expect(nextAssignmentStatus(undefined, "assign")).toBe("pending_activation");
    expect(nextAssignmentStatus(record("deactivated"), "assign")).toBe(
      "pending_activation",
    );
  });

  it("marks a revocation as in flight when one exists", () => {
    expect(nextAssignmentStatus(record("active"), "revoke")).toBe(
      "pending_deactivation",
    );
  });

  it("settles on the proven state", () => {
    expect(settleAssignmentStatus("assign", true)).toBe("active");
    expect(settleAssignmentStatus("revoke", true)).toBe("deactivated");
  });

  it("keeps a failure visible instead of claiming success", () => {
    expect(settleAssignmentStatus("assign", false)).toBe("activation_failed");
    expect(settleAssignmentStatus("revoke", false)).toBe("activation_failed");
  });
});
