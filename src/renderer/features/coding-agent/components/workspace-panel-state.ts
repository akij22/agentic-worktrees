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
