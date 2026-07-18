import type {
  CodingAgentSessionDto,
  CodingAgentWorktreeContextDto,
} from "../../../../shared/ipc/schemas";
import type { SessionGridDetail } from "../types";
import { compactActivity } from "./formatters";

export type SecondarySessionOption = {
  session: CodingAgentSessionDto;
  repository: string;
  branch: string;
  activity: string;
  detail: SessionGridDetail | undefined;
};

type BuildSecondarySessionOptionsInput = {
  primaryRunId: string;
  sessions: CodingAgentSessionDto[];
  contexts: CodingAgentWorktreeContextDto[];
  sessionDetails: Map<string, SessionGridDetail>;
  query: string;
};

export const buildSecondarySessionOptions = ({
  primaryRunId,
  sessions,
  contexts,
  sessionDetails,
  query,
}: BuildSecondarySessionOptionsInput): SecondarySessionOption[] => {
  const contextByWorktree = new Map(
    contexts.map((context) => [context.worktree.id, context]),
  );
  const normalizedQuery = query.trim().toLocaleLowerCase();

  return sessions
    .filter((session) => session.id !== primaryRunId)
    .map((session) => {
      const context = contextByWorktree.get(session.worktreeId);
      const detail = sessionDetails.get(session.id);

      return {
        session,
        repository:
          context?.repository.fullName ?? "Unavailable repository",
        branch: context?.worktree.branchName ?? "missing worktree",
        activity: compactActivity(detail?.lastActivity),
        detail,
      };
    })
    .filter((option) => {
      if (!normalizedQuery) return true;

      return [
        option.session.title,
        option.repository,
        option.branch,
        `${option.session.providerId}/${option.session.modelId}`,
        option.activity,
      ]
        .join(" ")
        .toLocaleLowerCase()
        .includes(normalizedQuery);
    })
    .sort(
      (left, right) =>
        new Date(right.session.updatedAt).getTime() -
        new Date(left.session.updatedAt).getTime(),
    );
};
