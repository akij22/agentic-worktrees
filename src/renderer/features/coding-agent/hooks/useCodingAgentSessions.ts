import { useCallback, useEffect, useState } from "react";
import type {
  CodingAgentSessionDto,
  CodingAgentStatusDto,
  CodingAgentWorktreeContextDto,
} from "../../../../shared/ipc/schemas";
import type { SessionGridDetail } from "../types";

export const useCodingAgentSessions = () => {
  const [status, setStatus] = useState<CodingAgentStatusDto>();
  const [contexts, setContexts] = useState<CodingAgentWorktreeContextDto[]>([]);
  const [sessions, setSessions] = useState<CodingAgentSessionDto[]>([]);
  const [sessionDetails, setSessionDetails] = useState<
    Map<string, SessionGridDetail>
  >(() => new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextStatus, nextContexts, nextSessions] = await Promise.all([
        window.api.codingAgent.getStatus(),
        window.api.codingAgent.listWorktrees(),
        window.api.codingAgent.listSessions(),
      ]);
      setStatus(nextStatus);
      setContexts(nextContexts);
      const detailResults = await Promise.all(
        nextSessions.map(async (session) => {
          try {
            const snapshot = await window.api.codingAgent.getSession({
              runId: session.id,
            });
            return {
              id: session.id,
              session: snapshot.session,
              detail: {
                lastActivity: snapshot.messages.at(-1)?.content,
                additions: snapshot.diff.reduce(
                  (total, file) => total + file.additions,
                  0,
                ),
                deletions: snapshot.diff.reduce(
                  (total, file) => total + file.deletions,
                  0,
                ),
                changedFiles: snapshot.diff.length,
              },
              error: undefined,
            };
          } catch (cause) {
            return {
              id: session.id,
              session,
              detail: {
                lastActivity: undefined,
                additions: 0,
                deletions: 0,
                changedFiles: 0,
              },
              error: cause instanceof Error ? cause.message : String(cause),
            };
          }
        }),
      );
      setSessions(detailResults.map(({ session }) => session));
      setSessionDetails(
        new Map(detailResults.map(({ id, detail }) => [id, detail])),
      );
      const failures = detailResults.filter((result) => result.error);
      setError(
        failures.length > 0
          ? `Could not load details for ${failures.length} session${failures.length === 1 ? "" : "s"}. Open a session to retry.`
          : undefined,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return {
    status,
    contexts,
    sessions,
    sessionDetails,
    loading,
    error,
    reload: load,
  };
};
