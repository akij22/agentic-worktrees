export const isFullBleedWorkspace = (pathname: string): boolean =>
  pathname === '/' ||
  pathname === '/worktrees' ||
  pathname === '/intelligence' ||
  pathname === '/chat' ||
  pathname.startsWith('/chat/');

export const NAV_SIDEBAR_MIN_WIDTH = 72;
export const NAV_SIDEBAR_EXPANDED_MIN_WIDTH = 192;
export const NAV_SIDEBAR_MAX_WIDTH = 320;
export const NAV_SIDEBAR_DEFAULT_WIDTH = NAV_SIDEBAR_MIN_WIDTH;

export const clampNavSidebarWidth = (width: number): number => {
  if (width < NAV_SIDEBAR_EXPANDED_MIN_WIDTH) {
    return NAV_SIDEBAR_MIN_WIDTH;
  }
  return Math.min(NAV_SIDEBAR_MAX_WIDTH, width);
};

export const isNavSidebarCollapsed = (width: number): boolean =>
  width < NAV_SIDEBAR_EXPANDED_MIN_WIDTH;
