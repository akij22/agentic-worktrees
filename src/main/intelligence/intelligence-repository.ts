import { and, eq, inArray } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { nanoid } from "nanoid";
import * as schema from "../../shared/db/schema";
import type {
	ChangedRange,
	ChangedSymbol,
	ClassifiedOverlap,
	CollectedFileChange,
	FileChangeType,
	IntelligenceRisk,
	OverlapTarget,
	OverlapTargetType,
	PersistedDiffComparison,
	PersistedIntelligenceSnapshot,
	PersistedIntelligenceWorktree,
	PersistedOverlapDetails,
} from "./types";

export interface IntelligenceRepository {
	replaceSnapshot(
		snapshot: PersistedIntelligenceSnapshot,
	): PersistedIntelligenceSnapshot;
	getLatestSnapshot(repositoryId: string): PersistedIntelligenceSnapshot | null;
	getOverlap(overlapId: string): PersistedOverlapDetails;
	compareDiffs(overlapId: string, targetId?: string): PersistedDiffComparison;
}

type Database = BetterSQLite3Database<typeof schema>;

const parseJson = <Value>(value: string): Value => {
	try {
		return JSON.parse(value) as Value;
	} catch (error) {
		throw new Error("Persisted intelligence JSON is invalid.", {
			cause: error,
		});
	}
};

const asRisk = (value: string): IntelligenceRisk => {
	if (value === "low" || value === "medium" || value === "high") return value;
	throw new Error(`Invalid persisted intelligence risk: ${value}`);
};

const asTargetType = (value: string): OverlapTargetType => {
	if (
		value === "folder" ||
		value === "module" ||
		value === "file" ||
		value === "symbol"
	) {
		return value;
	}
	throw new Error(`Invalid persisted overlap target type: ${value}`);
};

const asChangeType = (value: string): FileChangeType => {
	if (
		value === "added" ||
		value === "modified" ||
		value === "deleted" ||
		value === "renamed"
	) {
		return value;
	}
	throw new Error(`Invalid persisted file change type: ${value}`);
};

const insertSnapshotHierarchy = (
	database: Database,
	snapshot: PersistedIntelligenceSnapshot,
): void => {
	database
		.insert(schema.intelligenceSnapshots)
		.values({
			id: snapshot.id,
			repositoryId: snapshot.repositoryId,
			status: "complete",
			startedAt: new Date(snapshot.startedAt),
			completedAt: new Date(snapshot.completedAt),
			sourceMetadata: "{}",
			warnings: JSON.stringify(snapshot.warnings),
			createdAt: new Date(snapshot.completedAt),
			updatedAt: new Date(snapshot.completedAt),
		})
		.run();

	const analysisIdByWorktree = new Map<string, string>();
	const fileIdByWorktreePath = new Map<string, string>();
	for (const worktree of snapshot.worktrees) {
		analysisIdByWorktree.set(worktree.worktreeId, worktree.id);
		database
			.insert(schema.intelligenceWorktrees)
			.values({
				id: worktree.id,
				snapshotId: snapshot.id,
				worktreeId: worktree.worktreeId,
				runId: worktree.runId,
				agentKind: worktree.agentKind,
				agentName: worktree.agentName,
				agentStatus: worktree.status,
				task: worktree.task,
				branch: worktree.branch,
				baseBranch: worktree.baseBranch,
				additions: worktree.additions,
				deletions: worktree.deletions,
				changedFileCount: worktree.files.length,
				independent: worktree.independent,
				warning: worktree.warning,
				activityUpdatedAt: new Date(worktree.updatedAt),
			})
			.run();

		for (const file of worktree.files) {
			const fileId = nanoid();
			fileIdByWorktreePath.set(`${worktree.worktreeId}:${file.path}`, fileId);
			database
				.insert(schema.intelligenceChangedFiles)
				.values({
					id: fileId,
					intelligenceWorktreeId: worktree.id,
					path: file.path,
					previousPath: file.previousPath,
					changeType: file.changeType,
					folderPath: file.folderPath,
					modulePath: file.modulePath,
					additions: file.additions,
					deletions: file.deletions,
					ranges: JSON.stringify(file.ranges),
					patch: file.patch,
					binary: file.binary,
					fingerprint: file.fingerprint,
				})
				.run();
			if (file.symbols.length > 0) {
				database
					.insert(schema.intelligenceChangedSymbols)
					.values(
						file.symbols.map((symbol) => ({
							id: nanoid(),
							changedFileId: fileId,
							kind: symbol.kind,
							name: symbol.name,
							qualifiedName: symbol.qualifiedName,
							declarationStart: symbol.declarationStart,
							declarationEnd: symbol.declarationEnd,
							changedStart: symbol.changedStart,
							changedEnd: symbol.changedEnd,
						})),
					)
					.run();
			}
		}
	}

	snapshot.overlaps.forEach((overlap, overlapIndex) => {
		const leftId = analysisIdByWorktree.get(overlap.leftWorktreeId);
		const rightId = analysisIdByWorktree.get(overlap.rightWorktreeId);
		if (!leftId || !rightId) {
			throw new Error(`Overlap ${overlap.id} references an unknown worktree.`);
		}
		database
			.insert(schema.intelligenceOverlaps)
			.values({
				id: overlap.id,
				snapshotId: snapshot.id,
				leftIntelligenceWorktreeId: leftId,
				rightIntelligenceWorktreeId: rightId,
				risk: overlap.risk,
				category: overlap.category,
				reasonCode: overlap.reasonCode,
				summary: overlap.summary,
				actionable: overlap.actionable,
				sortOrder: overlapIndex,
			})
			.run();
		if (overlap.targets.length > 0) {
			database
				.insert(schema.intelligenceOverlapTargets)
				.values(
					overlap.targets.map((item, targetIndex) => ({
						id: nanoid(),
						overlapId: overlap.id,
						targetType: item.type,
						path: item.path,
						symbol: item.symbol,
						leftChangedFileId: item.leftFilePath
							? fileIdByWorktreePath.get(
									`${overlap.leftWorktreeId}:${item.leftFilePath}`,
								)
							: null,
						rightChangedFileId: item.rightFilePath
							? fileIdByWorktreePath.get(
									`${overlap.rightWorktreeId}:${item.rightFilePath}`,
								)
							: null,
						reasonCode: item.reasonCode,
						risk: item.risk,
						sortOrder: targetIndex,
					})),
				)
				.run();
		}
	});
};

const loadSnapshot = (
	database: Database,
	snapshotRow: typeof schema.intelligenceSnapshots.$inferSelect,
): PersistedIntelligenceSnapshot => {
	const worktreeRows = database
		.select()
		.from(schema.intelligenceWorktrees)
		.where(eq(schema.intelligenceWorktrees.snapshotId, snapshotRow.id))
		.all();
	const worktreeIds = worktreeRows.map(({ id }) => id);
	const fileRows =
		worktreeIds.length === 0
			? []
			: database
					.select()
					.from(schema.intelligenceChangedFiles)
					.where(
						inArray(
							schema.intelligenceChangedFiles.intelligenceWorktreeId,
							worktreeIds,
						),
					)
					.all();
	const fileIds = fileRows.map(({ id }) => id);
	const symbolRows =
		fileIds.length === 0
			? []
			: database
					.select()
					.from(schema.intelligenceChangedSymbols)
					.where(
						inArray(schema.intelligenceChangedSymbols.changedFileId, fileIds),
					)
					.all();
	const overlapRows = database
		.select()
		.from(schema.intelligenceOverlaps)
		.where(eq(schema.intelligenceOverlaps.snapshotId, snapshotRow.id))
		.all()
		.sort((left, right) => left.sortOrder - right.sortOrder);
	const overlapIds = overlapRows.map(({ id }) => id);
	const targetRows =
		overlapIds.length === 0
			? []
			: database
					.select()
					.from(schema.intelligenceOverlapTargets)
					.where(
						inArray(schema.intelligenceOverlapTargets.overlapId, overlapIds),
					)
					.all();

	const symbolsByFile = new Map<string, ChangedSymbol[]>();
	for (const row of symbolRows) {
		const values = symbolsByFile.get(row.changedFileId) ?? [];
		values.push({
			kind: row.kind,
			name: row.name,
			qualifiedName: row.qualifiedName,
			declarationStart: row.declarationStart,
			declarationEnd: row.declarationEnd,
			changedStart: row.changedStart,
			changedEnd: row.changedEnd,
		});
		symbolsByFile.set(row.changedFileId, values);
	}

	const filesByAnalysis = new Map<string, CollectedFileChange[]>();
	const filePathById = new Map<string, string>();
	for (const row of fileRows) {
		filePathById.set(row.id, row.path);
		const values = filesByAnalysis.get(row.intelligenceWorktreeId) ?? [];
		values.push({
			path: row.path,
			previousPath: row.previousPath,
			changeType: asChangeType(row.changeType),
			folderPath: row.folderPath,
			modulePath: row.modulePath,
			additions: row.additions,
			deletions: row.deletions,
			patch: row.patch,
			ranges: parseJson<ChangedRange[]>(row.ranges),
			binary: row.binary,
			fingerprint: row.fingerprint,
			afterContent: null,
			symbols: symbolsByFile.get(row.id) ?? [],
		});
		filesByAnalysis.set(row.intelligenceWorktreeId, values);
	}

	const worktrees = worktreeRows
		.map(
			(row): PersistedIntelligenceWorktree => ({
				id: row.id,
				worktreeId: row.worktreeId,
				runId: row.runId,
				task: row.task,
				branch: row.branch,
				baseBranch: row.baseBranch,
				agentKind:
					row.agentKind === "codex" || row.agentKind === "opencode"
						? row.agentKind
						: null,
				agentName: row.agentName,
				status: row.agentStatus,
				additions: row.additions,
				deletions: row.deletions,
				independent: row.independent,
				warning: row.warning,
				updatedAt: row.activityUpdatedAt.getTime(),
				files: (filesByAnalysis.get(row.id) ?? []).sort((left, right) =>
					left.path.localeCompare(right.path),
				),
			}),
		)
		.sort((left, right) => left.worktreeId.localeCompare(right.worktreeId));
	const worktreeIdByAnalysis = new Map(
		worktreeRows.map((row) => [row.id, row.worktreeId]),
	);
	const targetsByOverlap = new Map<string, OverlapTarget[]>();
	for (const row of targetRows.sort(
		(left, right) => left.sortOrder - right.sortOrder,
	)) {
		const values = targetsByOverlap.get(row.overlapId) ?? [];
		values.push({
			type: asTargetType(row.targetType),
			path: row.path,
			symbol: row.symbol,
			leftFilePath: row.leftChangedFileId
				? (filePathById.get(row.leftChangedFileId) ?? null)
				: null,
			rightFilePath: row.rightChangedFileId
				? (filePathById.get(row.rightChangedFileId) ?? null)
				: null,
			reasonCode: row.reasonCode,
			risk: asRisk(row.risk),
		});
		targetsByOverlap.set(row.overlapId, values);
	}
	const overlaps = overlapRows.map(
		(row): ClassifiedOverlap & { id: string } => {
			const leftWorktreeId = worktreeIdByAnalysis.get(
				row.leftIntelligenceWorktreeId,
			);
			const rightWorktreeId = worktreeIdByAnalysis.get(
				row.rightIntelligenceWorktreeId,
			);
			if (!leftWorktreeId || !rightWorktreeId) {
				throw new Error(`Persisted overlap ${row.id} has missing worktrees.`);
			}
			return {
				id: row.id,
				leftWorktreeId,
				rightWorktreeId,
				risk: asRisk(row.risk),
				category: asTargetType(row.category),
				reasonCode: row.reasonCode,
				summary: row.summary,
				actionable: row.actionable,
				targets: targetsByOverlap.get(row.id) ?? [],
			};
		},
	);

	return {
		id: snapshotRow.id,
		repositoryId: snapshotRow.repositoryId,
		startedAt: snapshotRow.startedAt.getTime(),
		completedAt: snapshotRow.completedAt.getTime(),
		warnings: parseJson<string[]>(snapshotRow.warnings),
		worktrees,
		overlaps,
	};
};

export const createIntelligenceRepository = (
	database: Database,
): IntelligenceRepository => ({
	replaceSnapshot(snapshot) {
		database.transaction((transaction) => {
			transaction
				.delete(schema.intelligenceSnapshots)
				.where(
					eq(schema.intelligenceSnapshots.repositoryId, snapshot.repositoryId),
				)
				.run();
			insertSnapshotHierarchy(transaction, snapshot);
		});
		const persisted = this.getLatestSnapshot(snapshot.repositoryId);
		if (!persisted) throw new Error("Intelligence snapshot was not persisted.");
		return persisted;
	},

	getLatestSnapshot(repositoryId) {
		const row = database
			.select()
			.from(schema.intelligenceSnapshots)
			.where(eq(schema.intelligenceSnapshots.repositoryId, repositoryId))
			.get();
		return row ? loadSnapshot(database, row) : null;
	},

	getOverlap(overlapId) {
		const overlapRow = database
			.select()
			.from(schema.intelligenceOverlaps)
			.where(eq(schema.intelligenceOverlaps.id, overlapId))
			.get();
		if (!overlapRow)
			throw new Error(`Intelligence overlap not found: ${overlapId}`);
		const snapshotRow = database
			.select()
			.from(schema.intelligenceSnapshots)
			.where(eq(schema.intelligenceSnapshots.id, overlapRow.snapshotId))
			.get();
		if (!snapshotRow)
			throw new Error(
				`Intelligence snapshot not found: ${overlapRow.snapshotId}`,
			);
		const snapshot = loadSnapshot(database, snapshotRow);
		const overlap = snapshot.overlaps.find(({ id }) => id === overlapId);
		if (!overlap)
			throw new Error(`Intelligence overlap not found: ${overlapId}`);
		const left = snapshot.worktrees.find(
			({ worktreeId }) => worktreeId === overlap.leftWorktreeId,
		);
		const right = snapshot.worktrees.find(
			({ worktreeId }) => worktreeId === overlap.rightWorktreeId,
		);
		if (!left || !right)
			throw new Error(`Overlap ${overlapId} has missing worktrees.`);
		return {
			repositoryId: snapshot.repositoryId,
			snapshotId: snapshot.id,
			overlap,
			left,
			right,
		};
	},

	compareDiffs(overlapId, targetId) {
		const details = this.getOverlap(overlapId);
		let leftFiles = details.left.files;
		let rightFiles = details.right.files;
		if (targetId) {
			const row = database
				.select()
				.from(schema.intelligenceOverlapTargets)
				.where(
					and(
						eq(schema.intelligenceOverlapTargets.id, targetId),
						eq(schema.intelligenceOverlapTargets.overlapId, overlapId),
					),
				)
				.get();
			if (!row)
				throw new Error(`Intelligence overlap target not found: ${targetId}`);
			const leftPath = row.leftChangedFileId
				? database
						.select({ path: schema.intelligenceChangedFiles.path })
						.from(schema.intelligenceChangedFiles)
						.where(
							eq(schema.intelligenceChangedFiles.id, row.leftChangedFileId),
						)
						.get()?.path
				: undefined;
			const rightPath = row.rightChangedFileId
				? database
						.select({ path: schema.intelligenceChangedFiles.path })
						.from(schema.intelligenceChangedFiles)
						.where(
							eq(schema.intelligenceChangedFiles.id, row.rightChangedFileId),
						)
						.get()?.path
				: undefined;
			leftFiles = leftPath
				? leftFiles.filter(({ path }) => path === leftPath)
				: leftFiles;
			rightFiles = rightPath
				? rightFiles.filter(({ path }) => path === rightPath)
				: rightFiles;
		}
		return {
			overlapId,
			left: {
				worktreeId: details.left.worktreeId,
				runId: details.left.runId,
				files: leftFiles,
			},
			right: {
				worktreeId: details.right.worktreeId,
				runId: details.right.runId,
				files: rightFiles,
			},
		};
	},
});
