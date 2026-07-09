export const IPC_CHANNELS = {
  GITHUB_LIST_REPOS: 'github:list-repos',
  GITHUB_LIST_BRANCHES: 'github:list-branches',
  WORKTREE_CREATE: 'worktree:create',
  WORKTREE_LIST: 'worktree:list',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];