import { describe, expect, it } from "vitest";
import type {
  CodingAgentMessageDto,
  CodingAgentToolCallDto,
} from "../../../../shared/ipc/schemas";
import { buildSessionMessageEntries } from "./session-messages";

const tool = (
  overrides: Partial<CodingAgentToolCallDto> & { id: string },
): CodingAgentToolCallDto => ({
  tool: "bash",
  status: "running",
  title: "npm test",
  detail: "",
  ...overrides,
});

const message = (
  overrides: Partial<CodingAgentMessageDto> & { id: string },
): CodingAgentMessageDto => ({
  role: "assistant",
  content: "",
  reasoning: "",
  tools: [],
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
      { kind: "thought", key: "thought:a1", text: "Second thought" },
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
      { kind: "thought", key: "thought:a1", text: "First thought" },
      { kind: "assistant", message: persistent },
      { kind: "thought", key: "thought:a3", text: "Next thought" },
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
      { kind: "thought", key: "thought:a1", text: "Final thought" },
      { kind: "assistant", message: persistent },
      { kind: "thought", key: "thought:a3", text: "Next thought" },
    ]);
  });

  it("namespaces a thought key when one message has reasoning and content", () => {
    const persistent = message({
      id: "a1",
      reasoning: "Final thought",
      content: "Answer",
    });

    expect(buildSessionMessageEntries([persistent])).toEqual([
      { kind: "thought", key: "thought:a1", text: "Final thought" },
      { kind: "assistant", message: persistent },
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
      { kind: "thought", key: "thought:a1", text: "Thinking" },
      { kind: "user", message: user },
      { kind: "thought", key: "thought:a2", text: "Next thought" },
    ]);
  });

  it("skips assistant messages without content, reasoning, or tools", () => {
    const entries = buildSessionMessageEntries([
      message({ id: "a1", content: "   ", reasoning: "  " }),
    ]);
    expect(entries).toEqual([]);
  });

  it("groups consecutive tool updates into one merged entry", () => {
    const first = tool({ id: "t1", status: "running" });
    const second = tool({ id: "t2", title: "npm run lint" });
    const entries = buildSessionMessageEntries([
      message({ id: "a1", tools: [first] }),
      message({ id: "a2", tools: [tool({ id: "t1", status: "completed" }), second] }),
    ]);
    expect(entries).toEqual([
      {
        kind: "tools",
        key: "tools:a1",
        tools: [
          tool({ id: "t1", status: "completed" }),
          tool({ id: "t2", title: "npm run lint" }),
        ],
      },
    ]);
  });

  it("closes an open tool entry when assistant content arrives", () => {
    const done = message({
      id: "a2",
      content: "All checks pass.",
      tools: [tool({ id: "t1", status: "completed" })],
    });
    const entries = buildSessionMessageEntries([
      message({ id: "a1", tools: [tool({ id: "t0" })] }),
      done,
      message({ id: "a3", tools: [tool({ id: "t9", title: "git status" })] }),
    ]);
    expect(entries).toEqual([
      {
        kind: "tools",
        key: "tools:a1",
        tools: [tool({ id: "t0" }), tool({ id: "t1", status: "completed" })],
      },
      { kind: "assistant", message: done },
      {
        kind: "tools",
        key: "tools:a3",
        tools: [tool({ id: "t9", title: "git status" })],
      },
    ]);
  });

  it("keeps tool-only messages instead of dropping them", () => {
    const entries = buildSessionMessageEntries([
      message({ id: "a1", tools: [tool({ id: "t1", status: "completed", detail: "ok" })] }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "tools" });
  });
});
