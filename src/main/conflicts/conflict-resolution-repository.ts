import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../../shared/db/schema";
import type {
	ConflictClassification,
	ConflictFileKind,
	ConflictOperationStatus,
	ConflictParticipantSide,
	ConflictResolutionState,
	GitConflictStage,
	PreparedConflictFile,
	PreparedConflictSession,
	SyntheticParticipant,
} from "./types";
import type { ChangedRange, IntelligenceRisk } from "../intelligence/types";

type Database = BetterSQLite3Database<typeof schema>;

export interface ConflictResolutionRepository {
	createSession(session: PreparedConflictSession): PreparedConflictSession;
	saveSession(session: PreparedConflictSession): PreparedConflictSession;
	getSession(sessionId: string): PreparedConflictSession | null;
	listSessions(repositoryId: string, overlapId?: string): PreparedConflictSession[];
	findActive(
		repositoryId: string,
		overlapId: string,
		targetBranch: string,
	): PreparedConflictSession | null;
}

const activeStates: ConflictResolutionState[] = [
	"requested",
	"capturing",
	"simulating",
	"preparing_sandbox",
];
const validStates = new Set<ConflictResolutionState>([
	...activeStates,
	"safe",
	"review_required",
	"conflict",
	"failed",
]);

const parseJson = <Value>(value: string, label: string): Value => {
	try {
		return JSON.parse(value) as Value;
	} catch (error) {
		throw new Error(`Persisted ${label} JSON is invalid.`, { cause: error });
	}
};

const state = (value: string): ConflictResolutionState => {
	if (validStates.has(value as ConflictResolutionState)) return value as ConflictResolutionState;
	throw new Error(`Invalid persisted conflict resolution state: ${value}`);
};

const classification = (value: string | null): ConflictClassification | null => {
	if (value === null || value === "safe" || value === "review_required" || value === "conflict") return value;
	throw new Error(`Invalid persisted conflict classification: ${value}`);
};

const side = (value: string): ConflictParticipantSide => {
	if (value === "left" || value === "right") return value;
	throw new Error(`Invalid persisted conflict participant side: ${value}`);
};

const fileKind = (value: string): ConflictFileKind => {
	if (value === "semantic_overlap" || value === "git_conflict") return value;
	throw new Error(`Invalid persisted conflict file kind: ${value}`);
};

const risk = (value: string): IntelligenceRisk => {
	if (value === "low" || value === "medium" || value === "high") return value;
	throw new Error(`Invalid persisted conflict file risk: ${value}`);
};

const operationStatus = (value: string): ConflictOperationStatus => {
	if (value === "running" || value === "succeeded" || value === "failed") return value;
	throw new Error(`Invalid persisted conflict operation status: ${value}`);
};

const insertChildren = (database: Database, session: PreparedConflictSession): void => {
	if (session.participants.length > 0) {
		database.insert(schema.conflictResolutionParticipants).values(
			session.participants.map((participant, index) => ({
				id: `${session.id}:participant:${participant.side}`,
				sessionId: session.id,
				side: participant.side,
				sortOrder: index,
				worktreeId: participant.worktreeId,
				runId: participant.runId,
				task: participant.task,
				agentName: participant.agentName,
				branch: participant.branch,
				originalHeadSha: participant.originalHeadSha,
				mergeBaseSha: participant.mergeBaseSha,
				syntheticCommitSha: participant.syntheticCommitSha,
				syntheticRef: participant.syntheticRef,
				statusFingerprintBefore: participant.statusFingerprintBefore,
				statusFingerprintAfter: participant.statusFingerprintAfter,
			})),
		).run();
	}
	if (session.files.length > 0) {
		database.insert(schema.conflictResolutionFiles).values(
			session.files.map((file, index) => ({
				id: `${session.id}:file:${index}`,
				sessionId: session.id,
				path: file.path,
				kind: file.kind,
				risk: file.risk,
				reasonCode: file.reasonCode,
				leftPath: file.leftPath,
				rightPath: file.rightPath,
				symbol: file.symbol,
				staticRanges: JSON.stringify(file.staticRanges),
				gitStages: JSON.stringify(file.gitStages),
				markerRanges: JSON.stringify(file.markerRanges),
				sortOrder: index,
			})),
		).run();
	}
	if (session.operations.length > 0) {
		database.insert(schema.conflictResolutionOperations).values(
			session.operations.map((operation) => ({
				id: operation.id,
				sessionId: session.id,
				sequence: operation.sequence,
				stage: operation.stage,
				kind: operation.kind,
				commandSummary: operation.commandSummary,
				status: operation.status,
				startedAt: new Date(operation.startedAt),
				completedAt: operation.completedAt === null ? null : new Date(operation.completedAt),
				outputSummary: operation.outputSummary,
				errorMessage: operation.errorMessage,
			})),
		).run();
	}
};

const sessionValues = (session: PreparedConflictSession) => ({
	id: session.id,
	repositoryId: session.repositoryId,
	snapshotId: session.snapshotId,
	overlapId: session.overlapId,
	targetBranch: session.targetBranch,
	targetCommitSha: session.targetCommitSha,
	state: session.state,
	classification: session.classification,
	currentStage: session.currentStage,
	integrationBranch: session.integrationBranch,
	integrationPath: session.integrationPath,
	retained: session.retained,
	cleanupPending: session.cleanupPending,
	errorMessage: session.errorMessage,
	createdAt: new Date(session.createdAt),
	updatedAt: new Date(session.updatedAt),
	completedAt: session.completedAt === null ? null : new Date(session.completedAt),
});

const loadSession = (
	database: Database,
	row: typeof schema.conflictResolutionSessions.$inferSelect,
): PreparedConflictSession => {
	const participantRows = database.select().from(schema.conflictResolutionParticipants)
		.where(eq(schema.conflictResolutionParticipants.sessionId, row.id))
		.orderBy(asc(schema.conflictResolutionParticipants.sortOrder)).all();
	const fileRows = database.select().from(schema.conflictResolutionFiles)
		.where(eq(schema.conflictResolutionFiles.sessionId, row.id))
		.orderBy(asc(schema.conflictResolutionFiles.sortOrder)).all();
	const operationRows = database.select().from(schema.conflictResolutionOperations)
		.where(eq(schema.conflictResolutionOperations.sessionId, row.id))
		.orderBy(asc(schema.conflictResolutionOperations.sequence)).all();

	return {
		id: row.id,
		repositoryId: row.repositoryId,
		snapshotId: row.snapshotId,
		overlapId: row.overlapId,
		targetBranch: row.targetBranch,
		targetCommitSha: row.targetCommitSha,
		state: state(row.state),
		classification: classification(row.classification),
		currentStage: row.currentStage,
		integrationBranch: row.integrationBranch,
		integrationPath: row.integrationPath,
		retained: row.retained,
		cleanupPending: row.cleanupPending,
		errorMessage: row.errorMessage,
		participants: participantRows.map<SyntheticParticipant>((participant) => ({
			side: side(participant.side),
			worktreeId: participant.worktreeId,
			runId: participant.runId,
			task: participant.task,
			agentName: participant.agentName,
			branch: participant.branch,
			originalHeadSha: participant.originalHeadSha,
			mergeBaseSha: participant.mergeBaseSha,
			syntheticCommitSha: participant.syntheticCommitSha,
			syntheticRef: participant.syntheticRef,
			statusFingerprintBefore: participant.statusFingerprintBefore,
			statusFingerprintAfter: participant.statusFingerprintAfter,
		})),
		files: fileRows.map<PreparedConflictFile>((file) => ({
			path: file.path,
			kind: fileKind(file.kind),
			risk: risk(file.risk),
			reasonCode: file.reasonCode,
			leftPath: file.leftPath,
			rightPath: file.rightPath,
			symbol: file.symbol,
			staticRanges: parseJson<ChangedRange[]>(file.staticRanges, "static ranges"),
			gitStages: parseJson<GitConflictStage[]>(file.gitStages, "Git stages"),
			markerRanges: parseJson<ChangedRange[]>(file.markerRanges, "marker ranges"),
		})),
		operations: operationRows.map((operation) => ({
			id: operation.id,
			sequence: operation.sequence,
			stage: state(operation.stage),
			kind: operation.kind,
			commandSummary: operation.commandSummary,
			status: operationStatus(operation.status),
			startedAt: operation.startedAt.getTime(),
			completedAt: operation.completedAt?.getTime() ?? null,
			outputSummary: operation.outputSummary,
			errorMessage: operation.errorMessage,
		})),
		createdAt: row.createdAt.getTime(),
		updatedAt: row.updatedAt.getTime(),
		completedAt: row.completedAt?.getTime() ?? null,
	};
};

export const createConflictResolutionRepository = (
	database: Database,
): ConflictResolutionRepository => ({
	createSession(session) {
		database.transaction((transaction) => {
			transaction.insert(schema.conflictResolutionSessions).values(sessionValues(session)).run();
			insertChildren(transaction, session);
		});
		const persisted = this.getSession(session.id);
		if (!persisted) throw new Error(`Conflict resolution session was not persisted: ${session.id}`);
		return persisted;
	},
	saveSession(session) {
		database.transaction((transaction) => {
			const updated = transaction.update(schema.conflictResolutionSessions)
				.set(sessionValues(session))
				.where(eq(schema.conflictResolutionSessions.id, session.id)).run();
			if (updated.changes !== 1) throw new Error(`Conflict resolution session not found: ${session.id}`);
			transaction.delete(schema.conflictResolutionParticipants)
				.where(eq(schema.conflictResolutionParticipants.sessionId, session.id)).run();
			transaction.delete(schema.conflictResolutionFiles)
				.where(eq(schema.conflictResolutionFiles.sessionId, session.id)).run();
			transaction.delete(schema.conflictResolutionOperations)
				.where(eq(schema.conflictResolutionOperations.sessionId, session.id)).run();
			insertChildren(transaction, session);
		});
		const persisted = this.getSession(session.id);
		if (!persisted) throw new Error(`Conflict resolution session was not persisted: ${session.id}`);
		return persisted;
	},
	getSession(sessionId) {
		const row = database.select().from(schema.conflictResolutionSessions)
			.where(eq(schema.conflictResolutionSessions.id, sessionId)).get();
		return row ? loadSession(database, row) : null;
	},
	listSessions(repositoryId, overlapId) {
		const rows = overlapId
			? database.select().from(schema.conflictResolutionSessions)
				.where(and(
					eq(schema.conflictResolutionSessions.repositoryId, repositoryId),
					eq(schema.conflictResolutionSessions.overlapId, overlapId),
				)).orderBy(desc(schema.conflictResolutionSessions.updatedAt)).all()
			: database.select().from(schema.conflictResolutionSessions)
				.where(eq(schema.conflictResolutionSessions.repositoryId, repositoryId))
				.orderBy(desc(schema.conflictResolutionSessions.updatedAt)).all();
		return rows.map((row) => loadSession(database, row));
	},
	findActive(repositoryId, overlapId, targetBranch) {
		const row = database.select().from(schema.conflictResolutionSessions)
			.where(and(
				eq(schema.conflictResolutionSessions.repositoryId, repositoryId),
				eq(schema.conflictResolutionSessions.overlapId, overlapId),
				eq(schema.conflictResolutionSessions.targetBranch, targetBranch),
				inArray(schema.conflictResolutionSessions.state, activeStates),
			)).orderBy(desc(schema.conflictResolutionSessions.updatedAt)).get();
		return row ? loadSession(database, row) : null;
	},
});
