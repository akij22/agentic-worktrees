import { describe, expect, it } from "vitest";
import {
  clampPrimaryPanelWidth,
  getSessionWorkspaceColumns,
  resolveSecondaryRunId,
  setSecondaryRunId,
} from "./dual-chat-layout";

describe("dual chat layout", () => {
  it("keeps both panels above their minimum width", () => {
    expect(clampPrimaryPanelWidth(1000, 100)).toBe(320);
    expect(clampPrimaryPanelWidth(1000, 900)).toBe(672);
    expect(clampPrimaryPanelWidth(1000, 420)).toBe(420);
  });

  it("uses half the available width as the effective minimum in a narrow container", () => {
    expect(clampPrimaryPanelWidth(500, 20)).toBe(246);
    expect(clampPrimaryPanelWidth(500, 480)).toBe(246);
  });

  it("accepts only an available secondary session different from the primary", () => {
    const available = ["primary", "secondary"];

    expect(
      resolveSecondaryRunId("primary", "secondary", available),
    ).toBe("secondary");
    expect(
      resolveSecondaryRunId("primary", "primary", available),
    ).toBeUndefined();
    expect(
      resolveSecondaryRunId("primary", "missing", available),
    ).toBeUndefined();
  });

  it("includes Inspection columns only in the single-session presentation", () => {
    expect(getSessionWorkspaceColumns(true, 368)).toBe(
      "minmax(0,1fr) 0.5rem 368px",
    );
    expect(getSessionWorkspaceColumns(false, 368)).toBe("minmax(0,1fr)");
  });

  it("updates the secondary session without mutating other query parameters", () => {
    const current = new URLSearchParams("new=1");
    const selected = setSecondaryRunId(current, "run/with spaces");

    expect(current.toString()).toBe("new=1");
    expect(selected.get("new")).toBe("1");
    expect(selected.get("secondaryRunId")).toBe("run/with spaces");
    expect(selected.toString()).toContain("secondaryRunId=run%2Fwith+spaces");

    const cleared = setSecondaryRunId(selected, undefined);
    expect(cleared.get("secondaryRunId")).toBeNull();
    expect(cleared.get("new")).toBe("1");
  });
});
