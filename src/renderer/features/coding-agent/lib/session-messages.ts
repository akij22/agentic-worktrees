import type {
  CodingAgentMessageDto,
  CodingAgentToolCallDto,
} from "../../../../shared/ipc/schemas";

export type ThoughtEntry = {
  kind: "thought";
  key: string;
  text: string;
};

export type ToolEntry = {
  kind: "tools";
  key: string;
  tools: CodingAgentToolCallDto[];
};

export type SessionMessageEntry =
  | { kind: "user"; message: CodingAgentMessageDto }
  | { kind: "assistant"; message: CodingAgentMessageDto }
  | ThoughtEntry
  | ToolEntry;

const mergeToolCalls = (
  current: CodingAgentToolCallDto[],
  next: CodingAgentToolCallDto[],
): CodingAgentToolCallDto[] => {
  const updates = new Map(next.map((tool) => [tool.id, tool]));
  const merged = current.map(
    (tool) => updates.get(tool.id) ?? tool,
  );
  const known = new Set(current.map((tool) => tool.id));
  for (const tool of next) {
    if (!known.has(tool.id)) merged.push(tool);
  }
  return merged;
};

/**
 * Keeps each reasoning stream and tool-call timeline next to the assistant
 * response it belongs to. Consecutive reasoning-only or tool-only updates
 * replace the open stream with its latest value, while assistant content
 * closes the streams without removing them.
 */
export const buildSessionMessageEntries = (
  messages: CodingAgentMessageDto[],
): SessionMessageEntry[] => {
  const entries: SessionMessageEntry[] = [];
  let openThought: ThoughtEntry | null = null;
  let openTools: ToolEntry | null = null;
  for (const message of messages) {
    if (message.role === "user") {
      openThought = null;
      openTools = null;
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
    if (message.tools.length > 0) {
      if (openTools) {
        openTools.tools = mergeToolCalls(openTools.tools, message.tools);
      } else {
        openTools = {
          kind: "tools",
          key: `tools:${message.id}`,
          tools: [...message.tools],
        };
        entries.push(openTools);
      }
    }
    if (message.content.trim().length > 0) {
      entries.push({ kind: "assistant", message });
      openThought = null;
      openTools = null;
    }
  }
  return entries;
};
