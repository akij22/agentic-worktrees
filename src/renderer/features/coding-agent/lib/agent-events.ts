import type { CodingAgentUiEventDto } from "../../../../shared/ipc/schemas";
import type { PendingPermission } from "../types";

export const readPermission = (payload: unknown): PendingPermission | null => {
  if (!payload || typeof payload !== "object") return null;
  if (!("id" in payload) || typeof payload.id !== "string") return null;
  return {
    id: payload.id,
    title:
      "title" in payload && typeof payload.title === "string"
        ? payload.title
        : "OpenCode requests permission",
    type:
      "type" in payload && typeof payload.type === "string"
        ? payload.type
        : "operation",
    metadata:
      "metadata" in payload &&
      payload.metadata &&
      typeof payload.metadata === "object"
        ? (payload.metadata as Record<string, unknown>)
        : {},
  };
};

export const readToolActivity = (
  event: CodingAgentUiEventDto,
): string | null => {
  if (event.type !== "message.part.updated") return null;
  const payload = event.payload;
  if (!payload || typeof payload !== "object" || !("part" in payload))
    return null;
  const part = payload.part;
  if (
    !part ||
    typeof part !== "object" ||
    !("type" in part) ||
    part.type !== "tool"
  ) {
    if (
      part &&
      typeof part === "object" &&
      "type" in part &&
      part.type === "reasoning"
    ) {
      const delta =
        "delta" in payload && typeof payload.delta === "string"
          ? payload.delta
          : "text" in part && typeof part.text === "string"
            ? part.text
            : "";
      return delta ? `Thinking… ${delta}` : "Thinking…";
    }
    return null;
  }
  const tool =
    "tool" in part && typeof part.tool === "string" ? part.tool : "tool";
  const state =
    "state" in part &&
    part.state &&
    typeof part.state === "object" &&
    "status" in part.state &&
    typeof part.state.status === "string"
      ? part.state.status
      : "running";
  return `${tool} · ${state}`;
};
