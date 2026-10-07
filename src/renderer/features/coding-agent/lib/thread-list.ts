import type {
  CodingAgentSessionDto,
  CodingAgentWorktreeContextDto,
} from "../../../../shared/ipc/schemas";
import type { SessionGridDetail } from "../types";

export type ThreadListEntry = {
  session: CodingAgentSessionDto;
  context: CodingAgentWorktreeContextDto | undefined;
  detail: SessionGridDetail | undefined;
  repositoryId: string;
  repositoryName: string;
  branchName: string | undefined;
  isDraft: boolean;
};

export type ThreadGroup =
  | { kind: "drafts"; label: "Drafts"; entries: ThreadListEntry[] }
  | { kind: "dated"; label: string; entries: ThreadListEntry[] };

const DAY_MS = 24 * 60 * 60 * 1000;

export const isDraftSession = (
  session: CodingAgentSessionDto,
  detail?: SessionGridDetail,
): boolean =>
  session.status === "idle" &&
  !session.title.trim() &&
  detail?.lastMessageAt == null;

export const getSessionStatusPresentation = (session: CodingAgentSessionDto) => {
  if (["busy", "creating", "aborting"].includes(session.status)) {
    return { label: "Working", className: "bg-primary" };
  }
  if (session.status === "waiting_permission") {
    return { label: "Needs attention", className: "bg-amber-400" };
  }
  if (session.status === "error") {
    return { label: "Error", className: "bg-destructive" };
  }
  return { label: "Ready", className: "bg-emerald-400" };
};

const startOfDay = (value: Date): number => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

const dayLabel = (value: Date, today: number): string => {
  const days = Math.round((today - startOfDay(value)) / DAY_MS);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "Earlier this week";
  return "Older";
};

export const buildThreadEntries = (
  contexts: CodingAgentWorktreeContextDto[],
  sessions: CodingAgentSessionDto[],
  sessionDetails: Map<string, SessionGridDetail>,
): ThreadListEntry[] => {
  const contextByWorktreeId = new Map(
    contexts.map((context) => [context.worktree.id, context]),
  );

  return sessions
    .map<ThreadListEntry>((session) => {
      const context = contextByWorktreeId.get(session.worktreeId);
      return {
        session,
        context,
        detail: sessionDetails.get(session.id),
        repositoryId: context?.repository.id ?? session.repositoryId,
        repositoryName:
          context?.repository.name ??
          context?.repository.fullName.split("/").at(-1) ??
          "Unavailable project",
        branchName: context?.worktree.branchName,
        isDraft: isDraftSession(session, sessionDetails.get(session.id)),
      };
    })
    .toSorted(
      (left, right) => {
        const leftMessageAt = left.detail?.lastMessageAt;
        const rightMessageAt = right.detail?.lastMessageAt;
        if (leftMessageAt != null && rightMessageAt == null) return -1;
        if (leftMessageAt == null && rightMessageAt != null) return 1;
        return (
          (rightMessageAt ?? new Date(right.session.createdAt).getTime()) -
          (leftMessageAt ?? new Date(left.session.createdAt).getTime())
        );
      },
    );
};

export const groupThreadEntries = (
  entries: ThreadListEntry[],
  now: Date = new Date(),
): ThreadGroup[] => {
  const today = startOfDay(now);
  const groups: ThreadGroup[] = [];

  for (const entry of entries) {
    if (entry.isDraft) continue;
    const label = dayLabel(new Date(entry.session.updatedAt), today);
    const last = groups.at(-1);
    if (last && last.kind === "dated" && last.label === label) {
      last.entries.push(entry);
      continue;
    }
    groups.push({ kind: "dated", label, entries: [entry] });
  }

  const drafts = entries.filter((entry) => entry.isDraft);
  if (drafts.length > 0) {
    groups.push({ kind: "drafts", label: "Drafts", entries: drafts });
  }
  return groups;
};

export const buildRepositoryFilters = (entries: ThreadListEntry[]) => {
  const counts = new Map<string, { id: string; name: string; count: number }>();
  for (const entry of entries) {
    const existing = counts.get(entry.repositoryId);
    if (existing) {
      existing.count += 1;
      continue;
    }
    counts.set(entry.repositoryId, {
      id: entry.repositoryId,
      name: entry.repositoryName,
      count: 1,
    });
  }
  return [...counts.values()].toSorted((left, right) =>
    left.name.localeCompare(right.name),
  );
};

export const filterThreadEntries = (
  entries: ThreadListEntry[],
  repositoryId: string | undefined,
): ThreadListEntry[] =>
  repositoryId
    ? entries.filter((entry) => entry.repositoryId === repositoryId)
    : entries;
