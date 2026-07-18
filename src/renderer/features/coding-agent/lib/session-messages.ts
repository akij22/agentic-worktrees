import type { CodingAgentMessageDto } from "../../../../shared/ipc/schemas";

type ThoughtEntry = {
  kind: "thought";
  key: string;
  text: string;
};

export type SessionMessageEntry =
  | { kind: "user"; message: CodingAgentMessageDto }
  | { kind: "assistant"; message: CodingAgentMessageDto }
  | ThoughtEntry;

/**
 * Collapses the model's chain of thoughts into a single entry per stream:
 * consecutive reasoning updates the same entry in place (only the latest
 * thought is shown), and a new thought entry can only start after a
 * persistent message (user message or assistant content) has been generated.
 * Once a persistent message is shown, its chain of thoughts disappears.
 */
export const buildSessionMessageEntries = (
  messages: CodingAgentMessageDto[],
): SessionMessageEntry[] => {
  const entries: SessionMessageEntry[] = [];
  let openThought: ThoughtEntry | null = null;
  let openThoughtIndex = -1;
  const dropOpenThought = (): void => {
    if (openThoughtIndex >= 0) entries.splice(openThoughtIndex, 1);
    openThought = null;
    openThoughtIndex = -1;
  };
  for (const message of messages) {
    if (message.role === "user") {
      dropOpenThought();
      entries.push({ kind: "user", message });
      continue;
    }
    if (message.reasoning.trim().length > 0) {
      if (openThought) {
        openThought.text = message.reasoning;
      } else {
        openThought = {
          kind: "thought",
          key: message.id,
          text: message.reasoning,
        };
        openThoughtIndex = entries.length;
        entries.push(openThought);
      }
    }
    if (message.content.trim().length > 0) {
      dropOpenThought();
      entries.push({ kind: "assistant", message });
    }
  }
  return entries;
};
