export const isDashboardWorkspace = (pathname: string): boolean =>
  pathname === '/';

export const DASHBOARD_SIDEBAR_MIN_WIDTH = 72;
export const DASHBOARD_SIDEBAR_EXPANDED_MIN_WIDTH = 192;
export const DASHBOARD_SIDEBAR_MAX_WIDTH = 320;
export const DASHBOARD_SIDEBAR_DEFAULT_WIDTH = DASHBOARD_SIDEBAR_MIN_WIDTH;

export const clampDashboardSidebarWidth = (width: number): number => {
  if (width < DASHBOARD_SIDEBAR_EXPANDED_MIN_WIDTH) {
    return DASHBOARD_SIDEBAR_MIN_WIDTH;
  }
  return Math.min(DASHBOARD_SIDEBAR_MAX_WIDTH, width);
};

export const isDashboardSidebarCollapsed = (width: number): boolean =>
  width < DASHBOARD_SIDEBAR_EXPANDED_MIN_WIDTH;
