import { describe, expect, it } from "vitest";
import {
  clampPrimaryPanelWidth,
  getDualChatGridTemplate,
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

  it("builds compatible collapsed and expanded dual-chat grid tracks", () => {
    expect(getDualChatGridTemplate(40, false)).toBe(
      "minmax(0, 100fr) 0px minmax(0, 0fr)",
    );
    expect(getDualChatGridTemplate(40, true)).toBe(
      "minmax(0, 40fr) 8px minmax(0, 60fr)",
    );
  });

  it("clamps dual-chat split ratios before building grid tracks", () => {
    expect(getDualChatGridTemplate(-10, true)).toContain(
      "minmax(0, 0fr) 8px minmax(0, 100fr)",
    );
    expect(getDualChatGridTemplate(120, true)).toContain(
      "minmax(0, 100fr) 8px minmax(0, 0fr)",
    );
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
