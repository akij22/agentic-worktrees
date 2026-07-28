import type { WorkspaceGitStatusDto } from '../../../../shared/ipc/schemas';

export const workspacePanelModes = [
  'review',
  'terminal',
  'files',
] as const;

export type WorkspacePanelMode = (typeof workspacePanelModes)[number];

const modeLabels: Record<WorkspacePanelMode, string> = {
  review: 'Revisione',
  terminal: 'Terminale',
  files: 'File',
};

export const getWorkspaceModeLabel = (
  mode: WorkspacePanelMode,
): string => modeLabels[mode];

export const canCommit = (
  status: WorkspaceGitStatusDto,
  busy: boolean,
): boolean => status.hasChanges && !busy;

export const canPush = (
  status: WorkspaceGitStatusDto,
  busy: boolean,
): boolean =>
  status.hasOrigin && status.hasUnpushedCommits && !busy;

export const shouldShowOpenPullRequest = (
  status: WorkspaceGitStatusDto,
): boolean => status.githubLinked;

export const canOpenPullRequest = (
  status: WorkspaceGitStatusDto,
  busy: boolean,
): boolean => status.pullRequestEligible && !busy;
