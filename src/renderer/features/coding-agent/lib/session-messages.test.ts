import { describe, expect, it } from "vitest";
import type { CodingAgentMessageDto } from "../../../../shared/ipc/schemas";
import { buildSessionMessageEntries } from "./session-messages";

const message = (
  overrides: Partial<CodingAgentMessageDto> & { id: string },
): CodingAgentMessageDto => ({
  role: "assistant",
  content: "",
  reasoning: "",
  createdAt: 0,
  completedAt: null,
  ...overrides,
});

describe("buildSessionMessageEntries", () => {
  it("shows a single thought entry updated with the latest reasoning", () => {
    const user = message({ id: "u1", role: "user", content: "Fix the bug" });
    const entries = buildSessionMessageEntries([
      user,
      message({ id: "a1", reasoning: "First thought" }),
      message({ id: "a2", reasoning: "Second thought" }),
    ]);
    expect(entries).toEqual([
      { kind: "user", message: user },
      { kind: "thought", key: "a1", text: "Second thought" },
    ]);
  });

  it("keeps the thought entry next to the persistent assistant message", () => {
    const persistent = message({ id: "a2", content: "Done." });
    const entries = buildSessionMessageEntries([
      message({ id: "a1", reasoning: "First thought" }),
      persistent,
      message({ id: "a3", reasoning: "Next thought" }),
    ]);
    expect(entries).toEqual([
      { kind: "thought", key: "a1", text: "First thought" },
      { kind: "assistant", message: persistent },
      { kind: "thought", key: "a3", text: "Next thought" },
    ]);
  });

  it("keeps the latest thought when a message has reasoning and content", () => {
    const persistent = message({
      id: "a2",
      reasoning: "Final thought",
      content: "Answer",
    });
    const entries = buildSessionMessageEntries([
      message({ id: "a1", reasoning: "Thinking" }),
      persistent,
      message({ id: "a3", reasoning: "Next thought" }),
    ]);
    expect(entries).toEqual([
      { kind: "thought", key: "a1", text: "Final thought" },
      { kind: "assistant", message: persistent },
      { kind: "thought", key: "a3", text: "Next thought" },
    ]);
  });

  it("keeps completed thoughts when a later user message is shown", () => {
    const user = message({ id: "u1", role: "user", content: "Thanks" });
    const entries = buildSessionMessageEntries([
      message({ id: "a1", reasoning: "Thinking" }),
      user,
      message({ id: "a2", reasoning: "Next thought" }),
    ]);
    expect(entries).toEqual([
      { kind: "thought", key: "a1", text: "Thinking" },
      { kind: "user", message: user },
      { kind: "thought", key: "a2", text: "Next thought" },
    ]);
  });

  it("skips assistant messages without content or reasoning", () => {
    const entries = buildSessionMessageEntries([
      message({ id: "a1", content: "   ", reasoning: "  " }),
    ]);
    expect(entries).toEqual([]);
  });
});
