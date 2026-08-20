import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { simpleGit, type SimpleGit } from "simple-git";
import {
	deriveModulePath,
	normalizeGitPath,
	shouldIgnoreIntelligencePath,
} from "./path-model";
import type {
	ChangedRange,
	CollectedFileChange,
	CollectedWorktreeChanges,
	FileChangeType,
} from "./types";

const MAX_TEXT_FILE_BYTES = 1024 * 1024;
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export interface GitChangeCollectorInput {
	worktreeId: string;
	repositoryId: string;
	worktreePath: string;
	branchName: string;
	baseBranchName: string;
}

export interface GitChangeCollector {
	collect(input: GitChangeCollectorInput): Promise<CollectedWorktreeChanges>;
}

interface NameStatusEntry {
	changeType: FileChangeType;
	path: string;
	previousPath: string | null;
}

interface GitChangeCollectorDependencies {
	createGit?: (worktreePath: string) => SimpleGit;
}

const parseNameStatus = (output: string): NameStatusEntry[] => {
	const fields = output.split("\0").filter(Boolean);
	const entries: NameStatusEntry[] = [];

	for (let index = 0; index < fields.length; ) {
		const status = fields[index++];
		if (!status) break;
		if (status.startsWith("R") || status.startsWith("C")) {
			const previousPath = fields[index++];
			const nextPath = fields[index++];
			if (!previousPath || !nextPath) break;
			entries.push({
				changeType: "renamed",
				previousPath: normalizeGitPath(previousPath),
				path: normalizeGitPath(nextPath),
			});
			continue;
		}

		const filePath = fields[index++];
		if (!filePath) break;
		let changeType: FileChangeType = "modified";
		if (status === "A") changeType = "added";
		if (status === "D") changeType = "deleted";
		entries.push({
			changeType,
			previousPath: null,
			path: normalizeGitPath(filePath),
		});
	}

	return entries;
};

export const parseChangedRanges = (patch: string): ChangedRange[] =>
	patch.split("\n").flatMap((line) => {
		const match = HUNK_HEADER.exec(line);
		if (!match) return [];
		return [
			{
				oldStart: Number(match[1]),
				oldLines: match[2] === undefined ? 1 : Number(match[2]),
				newStart: Number(match[3]),
				newLines: match[4] === undefined ? 1 : Number(match[4]),
			},
		];
	});

const parseNumstat = (
	output: string,
): {
	additions: number;
	deletions: number;
	binary: boolean;
} => {
	const [added = "0", removed = "0"] = output.trim().split("\t");
	const binary = added === "-" || removed === "-";
	return {
		additions: binary ? 0 : Number.parseInt(added, 10) || 0,
		deletions: binary ? 0 : Number.parseInt(removed, 10) || 0,
		binary,
	};
};

const resolveInsideWorktree = (root: string, relativePath: string): string => {
	const absoluteRoot = path.resolve(root);
	const absolutePath = path.resolve(absoluteRoot, relativePath);
	const relation = path.relative(absoluteRoot, absolutePath);
	if (relation.startsWith("..") || path.isAbsolute(relation)) {
		throw new Error(`Path resolves outside worktree: ${relativePath}`);
	}
	return absolutePath;
};

const readTextContent = async (
	root: string,
	relativePath: string,
): Promise<{ content: string | null; binary: boolean }> => {
	const absolutePath = resolveInsideWorktree(root, relativePath);
	const fileStat = await stat(absolutePath);
	if (fileStat.size > MAX_TEXT_FILE_BYTES) {
		return { content: null, binary: true };
	}
	const buffer = await readFile(absolutePath);
	if (buffer.includes(0)) return { content: null, binary: true };
	return { content: buffer.toString("utf8"), binary: false };
};

const createFingerprint = (
	change: Omit<CollectedFileChange, "fingerprint" | "symbols">,
): string =>
	createHash("sha256")
		.update(change.path)
		.update("\0")
		.update(change.patch ?? "")
		.update("\0")
		.update(`${change.additions}:${change.deletions}:${change.binary}`)
		.digest("hex");

const addedFilePatch = (filePath: string, content: string): string => {
	const lines = content.endsWith("\n")
		? content.slice(0, -1).split("\n")
		: content.split("\n");
	const body = lines.map((line) => `+${line}`).join("\n");
	return [
		`diff --git a/${filePath} b/${filePath}`,
		"new file mode 100644",
		"--- /dev/null",
		`+++ b/${filePath}`,
		`@@ -0,0 +1,${lines.length} @@`,
		body,
	].join("\n");
};

const folderFor = (filePath: string): string => {
	const folder = path.posix.dirname(filePath);
	return folder === "." ? "" : folder;
};

interface FileChangeContent {
	additions: number;
	deletions: number;
	patch: string | null;
	binary: boolean;
	afterContent: string | null;
}

const countLines = (content: string): number => {
	const lines = content.split("\n");
	return lines.at(-1) === "" ? lines.length - 1 : lines.length;
};

const completeFileChange = (
	entry: NameStatusEntry,
	content: FileChangeContent,
): CollectedFileChange => {
	const ranges =
		content.patch === null ? [] : parseChangedRanges(content.patch);
	const changeWithoutFingerprint = {
		path: entry.path,
		previousPath: entry.previousPath,
		changeType: entry.changeType,
		folderPath: folderFor(entry.path),
		modulePath: deriveModulePath(entry.path),
		additions: content.additions,
		deletions: content.deletions,
		patch: content.patch,
		ranges,
		binary: content.binary,
		afterContent: content.afterContent,
	};
	return {
		...changeWithoutFingerprint,
		fingerprint: createFingerprint(changeWithoutFingerprint),
		symbols: [],
	};
};

const collectUntrackedFile = async (
	worktreePath: string,
	entry: NameStatusEntry,
): Promise<CollectedFileChange> => {
	const content = await readTextContent(worktreePath, entry.path);
	return completeFileChange(entry, {
		additions: content.content === null ? 0 : countLines(content.content),
		deletions: 0,
		patch:
			content.content === null
				? null
				: addedFilePatch(entry.path, content.content),
		binary: content.binary,
		afterContent: content.content,
	});
};

const collectTrackedFile = async (
	git: SimpleGit,
	worktreePath: string,
	mergeBase: string,
	entry: NameStatusEntry,
): Promise<CollectedFileChange> => {
	const [numstat, rawPatch] = await Promise.all([
		git.raw([
			"diff",
			"--numstat",
			"--find-renames",
			mergeBase,
			"--",
			entry.path,
		]),
		git.raw([
			"diff",
			"--no-ext-diff",
			"--unified=0",
			"--find-renames",
			mergeBase,
			"--",
			entry.path,
		]),
	]);
	const stats = parseNumstat(numstat);
	let binary = stats.binary || rawPatch.includes("Binary files ");
	let afterContent: string | null = null;
	if (entry.changeType !== "deleted") {
		const content = await readTextContent(worktreePath, entry.path);
		binary ||= content.binary;
		afterContent = binary ? null : content.content;
	}
	return completeFileChange(entry, {
		additions: stats.additions,
		deletions: stats.deletions,
		patch: binary ? null : rawPatch,
		binary,
		afterContent,
	});
};

const parseUntrackedEntries = (output: string): NameStatusEntry[] =>
	output.split("\0").flatMap((filePath) =>
		filePath.length === 0
			? []
			: [
					{
						changeType: "added" as const,
						path: normalizeGitPath(filePath),
						previousPath: null,
					},
				],
	);

const resolveMergeBase = async (
	git: SimpleGit,
	input: GitChangeCollectorInput,
): Promise<string> => {
	try {
		const result = await git.raw(["merge-base", "HEAD", input.baseBranchName]);
		return result.trim();
	} catch (error) {
		throw new Error(
			`Worktree ${input.worktreeId} merge base could not be resolved against ${input.baseBranchName}.`,
			{ cause: error },
		);
	}
};

const collectEntries = async ({
	git,
	input,
	mergeBase,
	trackedEntries,
	untrackedEntries,
}: {
	git: SimpleGit;
	input: GitChangeCollectorInput;
	mergeBase: string;
	trackedEntries: NameStatusEntry[];
	untrackedEntries: NameStatusEntry[];
}): Promise<{ files: CollectedFileChange[]; warnings: string[] }> => {
	const files: CollectedFileChange[] = [];
	const warnings: string[] = [];
	const entries = [
		...trackedEntries.map((entry) => ({ entry, untracked: false })),
		...untrackedEntries.map((entry) => ({ entry, untracked: true })),
	];

	for (const { entry, untracked } of entries) {
		if (shouldIgnoreIntelligencePath(entry.path)) continue;
		try {
			files.push(
				untracked
					? await collectUntrackedFile(input.worktreePath, entry)
					: await collectTrackedFile(git, input.worktreePath, mergeBase, entry),
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			warnings.push(`${entry.path}: ${message}`);
		}
	}
	return { files, warnings };
};

export const createGitChangeCollector = (
	dependencies: GitChangeCollectorDependencies = {},
): GitChangeCollector => ({
	async collect(input) {
		const git =
			dependencies.createGit?.(input.worktreePath) ??
			simpleGit(input.worktreePath);
		const mergeBase = await resolveMergeBase(git, input);
		const [headOutput, nameStatus, untrackedOutput] = await Promise.all([
			git.raw(["rev-parse", "HEAD"]),
			git.raw([
				"diff",
				"--name-status",
				"-z",
				"--find-renames",
				mergeBase,
				"--",
			]),
			git.raw(["ls-files", "--others", "--exclude-standard", "-z", "--"]),
		]);
		const result = await collectEntries({
			git,
			input,
			mergeBase,
			trackedEntries: parseNameStatus(nameStatus),
			untrackedEntries: parseUntrackedEntries(untrackedOutput),
		});

		return {
			worktreeId: input.worktreeId,
			repositoryId: input.repositoryId,
			mergeBase,
			headSha: headOutput.trim(),
			files: result.files.sort((left, right) =>
				left.path.localeCompare(right.path),
			),
			warnings: result.warnings,
		};
	},
});
