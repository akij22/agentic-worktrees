import type { CodingAgentWorktreeContextDto } from "../../../../shared/ipc/schemas";

export const getWorkspaceLabel = (
	context: CodingAgentWorktreeContextDto,
): string =>
	context.worktree.kind === "primary"
		? `Main checkout · ${context.worktree.branchName}`
		: `${context.worktree.name} · ${context.worktree.branchName}`;

export const getWorkspaceShortLabel = (
	context: CodingAgentWorktreeContextDto,
): string =>
	context.worktree.kind === "primary"
		? "Main checkout"
		: context.worktree.branchName;
