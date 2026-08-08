import { useCallback, useEffect, useRef, useState } from "react";
import type { Worktree } from "../../../../shared/db/schema";
import type { CodingAgentSessionSnapshotDto } from "../../../../shared/ipc/schemas";

export type WorktreeChatSummaryState =
	| { status: "idle" | "loading" | "empty" }
	| { status: "ready"; snapshot: CodingAgentSessionSnapshotDto }
	| { status: "error"; message: string };

export const useWorktreeChatSummary = (
	worktree: Worktree | undefined,
	worktrees: readonly Worktree[],
): WorktreeChatSummaryState => {
	const [summaries, setSummaries] = useState<
		Record<string, WorktreeChatSummaryState | undefined>
	>({});
	const requestedWorktrees = useRef(new Set<string>());

	const load = useCallback(async (candidate: Worktree, refresh = false) => {
		if (!refresh && requestedWorktrees.current.has(candidate.id)) return;
		requestedWorktrees.current.add(candidate.id);
		setSummaries((current) =>
			current[candidate.id]
				? current
				: { ...current, [candidate.id]: { status: "loading" } },
		);

		try {
			const sessions = await window.api.codingAgent.listSessions({
				worktreeId: candidate.id,
			});
			const session =
				sessions.find((item) => item.id === candidate.activeRunId) ??
				sessions[0];

			if (!session) {
				setSummaries((current) => ({
					...current,
					[candidate.id]: { status: "empty" },
				}));
				return;
			}

			const snapshot = await window.api.codingAgent.getSession({
				runId: session.id,
			});
			setSummaries((current) => ({
				...current,
				[candidate.id]: { status: "ready", snapshot },
			}));
		} catch (error) {
			setSummaries((current) => ({
				...current,
				[candidate.id]: {
					status: "error",
					message: error instanceof Error ? error.message : String(error),
				},
			}));
		}
	}, []);

	useEffect(() => {
		worktrees.forEach((candidate) => void load(candidate));
	}, [load, worktrees]);

	useEffect(() => {
		if (!worktree?.activeRunId) return;

		return window.api.codingAgent.onEvent((event) => {
			if (
				event.runId === worktree.activeRunId &&
				(event.type === "messages.updated" || event.type === "diff.updated")
			) {
				void load(worktree, true);
			}
		});
	}, [load, worktree]);

	if (!worktree) return { status: "idle" };
	return summaries[worktree.id] ?? { status: "loading" };
};
