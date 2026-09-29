import { describe, expect, it } from "vitest";
import { formatListTimestamp } from "./formatters";

const now = new Date(2026, 8, 29, 21, 25);

describe("formatListTimestamp", () => {
  it("shows only the time for a thread updated today", () => {
    const stamp = formatListTimestamp(new Date(2026, 8, 29, 9, 5), now);
    expect(stamp).not.toMatch(/set|sep/);
  });

  it("shows only the day for an older thread", () => {
    const stamp = formatListTimestamp(new Date(2026, 8, 28, 21, 25), now);
    expect(stamp).not.toMatch(/21:25|:/);
  });

  it("keeps the time distinct from the day for a same-day stamp", () => {
    const stamp = formatListTimestamp(new Date(2026, 8, 29, 21, 25), now);
    expect(stamp.length).toBeLessThan(
      formatListTimestamp(new Date(2026, 8, 28, 21, 25), now).length + 4,
    );
  });
});
