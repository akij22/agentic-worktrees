import type { BranchDto } from "../../shared/ipc/schemas";
import type { IntelligenceRepository } from "../intelligence/intelligence-repository";
import { assertResolutionTransition } from "./conflict-classifier";
import type { ConflictResolutionRepository } from "./conflict-resolution-repository";
import type { IntegrationWorktreeService } from "./integration-worktree-service";
import type {
	ConflictResolutionOperation,
	ConflictResolutionState,
	PreparedConflictSession,
} from "./types";

interface RepositorySource {
	id: string;
	localRootPath: string | null;
	defaultBranch: string | null;
}

interface WorktreeSource {
	id: string;
	repositoryId: string;
	path: string;
	branchName: string;
}

export interface ConflictSessionChangedEvent {
	sessionId: string;
	repositoryId: string;
	state: ConflictResolutionState;
	updatedAt: number;
}

export interface ConflictIntelligenceService {
	listTargetBranches(repositoryId: string): Promise<BranchDto[]>;
	prepareConflict(input: {
		overlapId: string;
		targetBranch: string;
	}): Promise<PreparedConflictSession>;
	getSession(sessionId: string): PreparedConflictSession;
	listSessions(input: {
		repositoryId: string;
		overlapId?: string;
	}): PreparedConflictSession[];
	onSessionChanged(
		listener: (event: ConflictSessionChangedEvent) => void,
	): () => void;
	reconcileInterruptedSessions(): void;
}

export interface ConflictIntelligenceServiceDependencies {
	resolutionRepository: ConflictResolutionRepository;
	intelligenceRepository: IntelligenceRepository;
	lifecycle: IntegrationWorktreeService;
	getRepository(id: string): RepositorySource | undefined;
	listRepositories?(): RepositorySource[];
	getWorktree(id: string): WorktreeSource | undefined;
	listBranches(repositoryPath: string): Promise<BranchDto[]>;
	createId(): string;
	now(): number;
}

const terminalStates = new Set<ConflictResolutionState>([
	"safe",
	"review_required",
	"conflict",
	"failed",
]);

const errorMessage = (cause: unknown): string =>
	cause instanceof Error && cause.message ? cause.message : String(cause);

export const createConflictIntelligenceService = (
	dependencies: ConflictIntelligenceServiceDependencies,
): ConflictIntelligenceService => {
	const listeners = new Set<(event: ConflictSessionChangedEvent) => void>();
	const inFlight = new Map<string, Promise<PreparedConflictSession>>();
	const repositoryQueues = new Map<string, Promise<void>>();

	const emit = (session: PreparedConflictSession): void => {
		const event: ConflictSessionChangedEvent = {
			sessionId: session.id,
			repositoryId: session.repositoryId,
			state: session.state,
			updatedAt: session.updatedAt,
		};
		for (const listener of listeners) listener(event);
	};

	const enqueue = <Value>(
		repositoryId: string,
		operation: () => Promise<Value>,
	): Promise<Value> => {
		const previous = repositoryQueues.get(repositoryId) ?? Promise.resolve();
		const result = previous.catch(() => undefined).then(operation);
		repositoryQueues.set(
			repositoryId,
			result.then(
				() => undefined,
				() => undefined,
			),
		);
		return result;
	};

	const service: ConflictIntelligenceService = {
		async listTargetBranches(repositoryId) {
			const repository = dependencies.getRepository(repositoryId);
			if (!repository?.localRootPath)
				throw new Error(`Repository is not available locally: ${repositoryId}`);
			return dependencies.listBranches(repository.localRootPath);
		},
		async prepareConflict({ overlapId, targetBranch }) {
			const details = dependencies.intelligenceRepository.getOverlap(overlapId);
			const repository = dependencies.getRepository(details.repositoryId);
			if (!repository?.localRootPath)
				throw new Error(
					`Repository is not available locally: ${details.repositoryId}`,
				);
			const repositoryPath = repository.localRootPath;
			const branches = await dependencies.listBranches(repositoryPath);
			if (!branches.some(({ name }) => name === targetBranch)) {
				throw new Error(`Target branch is not available: ${targetBranch}`);
			}
			const key = `${details.repositoryId}\0${overlapId}\0${targetBranch}`;
			const existingPromise = inFlight.get(key);
			if (existingPromise) return existingPromise;
			const persistedActive = dependencies.resolutionRepository.findActive(
				details.repositoryId,
				overlapId,
				targetBranch,
			);
			if (persistedActive) return persistedActive;

			const promise = enqueue(details.repositoryId, async () => {
				const left = dependencies.getWorktree(details.left.worktreeId);
				const right = dependencies.getWorktree(details.right.worktreeId);
				if (!left || !right)
					throw new Error(
						`Conflict participants are no longer available: ${overlapId}`,
					);
				if (
					left.repositoryId !== details.repositoryId ||
					right.repositoryId !== details.repositoryId
				) {
					throw new Error(
						"Conflict participants do not belong to the overlap repository.",
					);
				}
				const createdAt = dependencies.now();
				let current: PreparedConflictSession = {
					id: dependencies.createId(),
					repositoryId: details.repositoryId,
					snapshotId: details.snapshotId,
					overlapId,
					targetBranch,
					targetCommitSha: null,
					state: "requested",
					classification: null,
					currentStage: "Requested",
					integrationBranch: null,
					integrationPath: null,
					retained: false,
					cleanupPending: false,
					errorMessage: null,
					participants: [],
					files: [],
					operations: [],
					createdAt,
					updatedAt: createdAt,
					completedAt: null,
				};
				current = dependencies.resolutionRepository.createSession(current);
				emit(current);

				const transition = (
					next: ConflictResolutionState,
					label: string,
					kind: string,
				): void => {
					if (current.state === next) return;
					assertResolutionTransition(current.state, next);
					const timestamp = dependencies.now();
					const operation: ConflictResolutionOperation = {
						id: `${current.id}:operation:${current.operations.length + 1}`,
						sequence: current.operations.length + 1,
						stage: next,
						kind,
						commandSummary: null,
						status: "succeeded",
						startedAt: timestamp,
						completedAt: timestamp,
						outputSummary: label,
						errorMessage: null,
					};
					current = dependencies.resolutionRepository.saveSession({
						...current,
						state: next,
						currentStage: label,
						operations: [...current.operations, operation],
						updatedAt: timestamp,
					});
					emit(current);
				};

				try {
					const result = await dependencies.lifecycle.prepare({
						sessionId: current.id,
						repository: { id: details.repositoryId, path: repositoryPath },
						targetBranch,
						participants: [
							{
								side: "left",
								repositoryId: details.repositoryId,
								worktreeId: left.id,
								runId: details.left.runId,
								task: details.left.task,
								agentName: details.left.agentName,
								branch: left.branchName,
								path: left.path,
							},
							{
								side: "right",
								repositoryId: details.repositoryId,
								worktreeId: right.id,
								runId: details.right.runId,
								task: details.right.task,
								agentName: details.right.agentName,
								branch: right.branchName,
								path: right.path,
							},
						],
						targets: details.overlap.targets,
						onStage: (stage, label) =>
							transition(
								stage,
								label,
								stage === "capturing"
									? "capture"
									: stage === "simulating"
										? "simulate"
										: "prepare-sandbox",
							),
					});
					const finalState = result.classification;
					if (finalState !== "safe" && current.state === "simulating") {
						transition(
							"preparing_sandbox",
							"Preparing isolated integration sandbox",
							"prepare-sandbox",
						);
					}
					assertResolutionTransition(current.state, finalState);
					const completedAt = dependencies.now();
					current = dependencies.resolutionRepository.saveSession({
						...current,
						state: finalState,
						classification: result.classification,
						currentStage:
							finalState === "safe"
								? "Git mergeable"
								: finalState === "conflict"
									? "Git confirmed conflict"
									: "Semantic review required",
						targetCommitSha: result.targetCommitSha,
						participants: result.participants,
						files: result.files,
						integrationBranch: result.integrationBranch,
						integrationPath: result.integrationPath,
						retained: result.retained,
						cleanupPending: result.cleanupPending,
						updatedAt: completedAt,
						completedAt,
					});
					emit(current);
					return current;
				} catch (cause) {
					if (!terminalStates.has(current.state)) {
						assertResolutionTransition(current.state, "failed");
						const completedAt = dependencies.now();
						current = dependencies.resolutionRepository.saveSession({
							...current,
							state: "failed",
							currentStage: "Preparation failed",
							errorMessage: errorMessage(cause),
							updatedAt: completedAt,
							completedAt,
						});
						emit(current);
					}
					throw cause;
				}
			});
			inFlight.set(key, promise);
			void promise.finally(() => inFlight.delete(key)).catch(() => undefined);
			return promise;
		},
		getSession(sessionId) {
			const session = dependencies.resolutionRepository.getSession(sessionId);
			if (!session)
				throw new Error(`Conflict resolution session not found: ${sessionId}`);
			return session;
		},
		listSessions(input) {
			return dependencies.resolutionRepository.listSessions(
				input.repositoryId,
				input.overlapId,
			);
		},
		onSessionChanged(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		reconcileInterruptedSessions() {
			for (const repository of dependencies.listRepositories?.() ?? []) {
				for (const session of dependencies.resolutionRepository.listSessions(
					repository.id,
				)) {
					if (terminalStates.has(session.state)) continue;
					const completedAt = dependencies.now();
					const failed = dependencies.resolutionRepository.saveSession({
						...session,
						state: "failed",
						currentStage: "Interrupted preparation",
						errorMessage:
							"Preparation was interrupted before Git confirmation completed.",
						updatedAt: completedAt,
						completedAt,
					});
					emit(failed);
				}
			}
		},
	};

	return service;
};
