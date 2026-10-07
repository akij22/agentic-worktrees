import { useCallback, useEffect, useRef, useState } from "react";
import type {
	CodingAgentSessionDto,
	CodingAgentStatusDto,
	CodingAgentWorktreeContextDto,
} from "../../../../shared/ipc/schemas";
import { CoalescingTaskQueue } from "../lib/coalescing-task-queue";
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
	const requestReloadRef = useRef<() => Promise<void>>(async () => undefined);
	const detailErrorsRef = useRef(new Set<string>());
	const load = useCallback(async (
		showLoading: boolean,
		runIds: Set<string> | undefined,
		isCurrent: () => boolean,
	) => {
		if (showLoading) setLoading(true);
		try {
			let nextSessions: CodingAgentSessionDto[];
			if (runIds) {
				nextSessions = await window.api.codingAgent.listSessions();
			} else {
				const [nextStatus, nextContexts, listedSessions] = await Promise.all([
					window.api.codingAgent.getStatus(),
					window.api.codingAgent.listWorktrees(),
					window.api.codingAgent.listSessions(),
				]);
				if (!isCurrent()) return;
				setStatus(nextStatus);
				setContexts(nextContexts);
				nextSessions = listedSessions;
			}
			if (!isCurrent()) return;
			setSessions(nextSessions);
			if (showLoading) setLoading(false);
			const sessionsToRefresh = runIds
				? nextSessions.filter((session) => runIds.has(session.id))
				: nextSessions;
			const detailResults = await Promise.all(
				sessionsToRefresh.map(async (session) => {
					try {
						const snapshot = await window.api.codingAgent.getSession({
							runId: session.id,
						});
						return {
							id: session.id,
							session: snapshot.session,
							detail: {
								lastActivity: snapshot.messages.at(-1)?.content,
								lastMessageAt: snapshot.messages.at(-1)?.createdAt ?? null,
								isProcessing:
									["creating", "busy"].includes(snapshot.session.status) &&
									!(
										snapshot.messages.at(-1)?.role === "assistant" &&
										snapshot.messages.at(-1)?.completedAt !== null
									),
								additions: snapshot.diff.reduce(
									(total, file) => total + file.additions,
									0,
								),
								deletions: snapshot.diff.reduce(
									(total, file) => total + file.deletions,
									0,
								),
								changedFiles: snapshot.diff.length,
								activeCapabilities: snapshot.capabilities
									.filter(({ state }) => state === "active")
									.map(({ id, name }) => ({ id, name })),
								},
							error: undefined,
						};
					} catch (cause) {
						return {
							id: session.id,
							session,
							detail: {
								lastActivity: undefined,
								lastMessageAt: null,
								isProcessing: ["creating", "busy"].includes(session.status),
								additions: 0,
								deletions: 0,
								changedFiles: 0,
								activeCapabilities: [],
							},
							error: cause instanceof Error ? cause.message : String(cause),
						};
					}
				}),
			);
			if (!isCurrent()) return;
			const refreshed = new Map(detailResults.map((result) => [result.id, result]));
			setSessions(nextSessions.map((session) => refreshed.get(session.id)?.session ?? session));
			setSessionDetails((current) => new Map(nextSessions.flatMap((session) => {
				const detail = refreshed.get(session.id)?.detail ?? current.get(session.id);
				return detail ? [[session.id, detail] as const] : [];
			})));
			const existingIds = new Set(nextSessions.map((session) => session.id));
			for (const id of detailErrorsRef.current) {
				if (!existingIds.has(id)) detailErrorsRef.current.delete(id);
			}
			for (const result of detailResults) {
				if (result.error) detailErrorsRef.current.add(result.id);
				else detailErrorsRef.current.delete(result.id);
			}
			const failureCount = detailErrorsRef.current.size;
			setError(failureCount > 0
				? `Could not load details for ${failureCount} session${failureCount === 1 ? "" : "s"}. Open a session to retry.`
				: undefined);
		} catch (cause) {
			if (isCurrent()) setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			if (isCurrent()) setLoading(false);
		}
	}, []);
	useEffect(() => {
		let cancelled = false;
		let fullRefresh = true;
		const pendingRunIds = new Set<string>();
		const queue = new CoalescingTaskQueue(async () => {
			if (cancelled) return;
			const refreshAll = fullRefresh;
			const runIds = new Set(pendingRunIds);
			fullRefresh = false;
			pendingRunIds.clear();
			await load(refreshAll, refreshAll ? undefined : runIds, () => !cancelled);
		});
		requestReloadRef.current = () => {
			fullRefresh = true;
			return queue.request();
		};
		void queue.request();
		const unsubscribe = window.api.codingAgent.onEvent((event) => {
			if (
				event.runId !== null &&
				["messages.updated", "session.diff", "session.idle", "session.error", "session.status"].includes(event.type)
			) {
				pendingRunIds.add(event.runId);
				void queue.request();
			}
		});
		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, [load]);
	const reload = useCallback(() => requestReloadRef.current(), []);
	return {
		status,
		contexts,
		sessions,
		sessionDetails,
		loading,
		error,
		reload,
	};
};
