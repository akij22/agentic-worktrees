export const isFullBleedWorkspace = (pathname: string): boolean =>
  pathname === '/' ||
  pathname === '/worktrees' ||
  pathname === '/intelligence' ||
  pathname === '/marketplace' ||
  pathname === '/chat' ||
  pathname.startsWith('/chat/');

export const WORKSPACE_SIDEBAR_DEFAULT_WIDTH = 300;
