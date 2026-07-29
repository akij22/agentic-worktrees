import type { CodingAgentMessageDto } from "../../../../shared/ipc/schemas";

export type ThoughtEntry = {
  kind: "thought";
  key: string;
  text: string;
};

export type SessionMessageEntry =
  | { kind: "user"; message: CodingAgentMessageDto }
  | { kind: "assistant"; message: CodingAgentMessageDto }
  | ThoughtEntry;

/**
 * Keeps each reasoning stream next to the assistant response it belongs to.
 * Consecutive reasoning-only updates replace the open stream with its latest
 * value, while assistant content closes the stream without removing it.
 */
export const buildSessionMessageEntries = (
  messages: CodingAgentMessageDto[],
): SessionMessageEntry[] => {
  const entries: SessionMessageEntry[] = [];
  let openThought: ThoughtEntry | null = null;
  for (const message of messages) {
    if (message.role === "user") {
      openThought = null;
      entries.push({ kind: "user", message });
      continue;
    }
    if (message.reasoning.trim().length > 0) {
      if (openThought) {
        openThought.text = message.reasoning;
      } else {
        openThought = {
          kind: "thought",
          key: `thought:${message.id}`,
          text: message.reasoning,
        };
        entries.push(openThought);
      }
    }
    if (message.content.trim().length > 0) {
      entries.push({ kind: "assistant", message });
      openThought = null;
    }
  }
  return entries;
};
