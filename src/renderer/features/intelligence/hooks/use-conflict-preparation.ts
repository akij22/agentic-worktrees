import { useCallback, useEffect, useState } from "react";
import type {
	BranchDto,
	ConflictResolutionSessionDto,
} from "../../../../shared/ipc/schemas";

const message = (cause: unknown): string =>
	cause instanceof Error ? cause.message : String(cause);

export const useConflictPreparation = (
	repositoryId: string | undefined,
	overlapId: string | undefined,
	defaultBranch: string | null | undefined,
) => {
	const [branches, setBranches] = useState<BranchDto[]>([]);
	const [targetBranch, setTargetBranch] = useState("");
	const [session, setSession] = useState<ConflictResolutionSessionDto>();
	const [loading, setLoading] = useState(false);
	const [preparing, setPreparing] = useState(false);
	const [error, setError] = useState<string>();

	const reloadSessions = useCallback(async () => {
		if (!repositoryId || !overlapId) {
			setSession(undefined);
			return;
		}
		const sessions = await window.api.intelligence.listResolutionSessions({
			repositoryId,
			overlapId,
		});
		setSession(sessions[0]);
	}, [overlapId, repositoryId]);

	useEffect(() => {
		if (!repositoryId || !overlapId) {
			setBranches([]);
			setTargetBranch("");
			setSession(undefined);
			return;
		}
		let cancelled = false;
		setLoading(true);
		setError(undefined);
		void Promise.all([
			window.api.intelligence.listTargetBranches({ repositoryId }),
			window.api.intelligence.listResolutionSessions({ repositoryId, overlapId }),
		]).then(([values, sessions]) => {
			if (cancelled) return;
			setBranches(values);
			setTargetBranch((current) => {
				if (current && values.some(({ name }) => name === current)) return current;
				if (defaultBranch && values.some(({ name }) => name === defaultBranch)) return defaultBranch;
				return values[0]?.name ?? "";
			});
			setSession(sessions[0]);
		}).catch((cause: unknown) => {
			if (!cancelled) setError(message(cause));
		}).finally(() => {
			if (!cancelled) setLoading(false);
		});
		return () => {
			cancelled = true;
		};
	}, [defaultBranch, overlapId, repositoryId]);

	useEffect(() => window.api.intelligence.onResolutionSessionChanged((event) => {
		if (event.repositoryId !== repositoryId) return;
		void reloadSessions().catch((cause: unknown) => setError(message(cause)));
	}), [reloadSessions, repositoryId]);

	const prepare = useCallback(async () => {
		if (!overlapId || !targetBranch) return;
		setPreparing(true);
		setError(undefined);
		try {
			setSession(await window.api.intelligence.prepareConflict({
				overlapId,
				targetBranch,
			}));
		} catch (cause) {
			setError(message(cause));
			throw cause;
		} finally {
			setPreparing(false);
		}
	}, [overlapId, targetBranch]);

	return {
		branches,
		targetBranch,
		selectTargetBranch: setTargetBranch,
		session,
		loading,
		preparing,
		error,
		prepare,
	};
};
