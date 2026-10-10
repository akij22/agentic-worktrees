import { useMemo } from "react";
import type { CodingAgentMessageDto, CodingAgentWorktreeContextDto } from "../../../../shared/ipc/schemas";

export const resolveLandingPrompt = (
  context: CodingAgentWorktreeContextDto | undefined,
): string =>
  context
    ? `What should we build in ${context.worktree.branchName}?`
    : "What should we build?";

export const resolveDefaultWorktreeId = (
  contexts: CodingAgentWorktreeContextDto[],
  sessions: { worktreeId: string; updatedAt: Date }[],
): string | undefined => {
  if (contexts.length === 0) return undefined;
  const available = new Set(contexts.map(({ worktree }) => worktree.id));
  const mostRecent = sessions
    .filter((session) => available.has(session.worktreeId))
    .toSorted(
      (left, right) =>
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
    )
    .at(0);
  if (mostRecent) return mostRecent.worktreeId;

  const primary = contexts.find(({ worktree }) => worktree.kind === "primary");
  return (primary ?? contexts[0])?.worktree.id;
};

export const findReusableDraft = <T extends { worktreeId: string; isDraft: boolean }>(
  entries: T[],
  worktreeId: string | undefined,
): T | undefined =>
  worktreeId
    ? entries.find((entry) => entry.isDraft && entry.worktreeId === worktreeId)
    : undefined;

export const buildLandingThreadCounts = (entries: { isDraft: boolean }[]) => ({
  total: entries.length,
  drafts: entries.filter((entry) => entry.isDraft).length,
});

export const useResolvedWorktree = (
  contexts: CodingAgentWorktreeContextDto[],
  selectedWorktreeId: string | undefined,
) =>
  useMemo(
    () =>
      contexts.find(({ worktree }) => worktree.id === selectedWorktreeId),
    [contexts, selectedWorktreeId],
  );

export const readLandingSubmission = (state: unknown, runId: string): {
  runId: string;
  agentName: string;
  message: CodingAgentMessageDto;
} | undefined => {
  if (!state || typeof state !== "object" || !("landingSubmission" in state)) return undefined;
  const submission = state.landingSubmission;
  if (!submission || typeof submission !== "object" ||
      !("runId" in submission) || submission.runId !== runId ||
      !("agentName" in submission) || typeof submission.agentName !== "string" ||
      !("message" in submission)) return undefined;
  const message = submission.message;
  if (!message || typeof message !== "object" ||
      !("id" in message) || typeof message.id !== "string" ||
      !("role" in message) || message.role !== "user" ||
      !("content" in message) || typeof message.content !== "string" ||
      !("createdAt" in message) || typeof message.createdAt !== "number" ||
      !Number.isFinite(message.createdAt)) return undefined;
  return {
    runId,
    agentName: submission.agentName,
    message: {
      id: message.id, role: "user", content: message.content,
      createdAt: message.createdAt, completedAt: null, reasoning: "", tools: [],
    },
  };
};

export const includeSubmittedMessage = (
  messages: CodingAgentMessageDto[],
  submitted: CodingAgentMessageDto | undefined,
): CodingAgentMessageDto[] => submitted && !messages.some(
  (message) => message.role === "user" && message.content === submitted.content,
) ? [submitted, ...messages] : messages;
