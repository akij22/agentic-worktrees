export const isDashboardWorkspace = (pathname: string): boolean =>
  pathname === '/';

export const DASHBOARD_SIDEBAR_MIN_WIDTH = 72;
export const DASHBOARD_SIDEBAR_MAX_WIDTH = 320;
export const DASHBOARD_SIDEBAR_DEFAULT_WIDTH = DASHBOARD_SIDEBAR_MIN_WIDTH;

export const clampDashboardSidebarWidth = (width: number): number =>
  Math.min(
    DASHBOARD_SIDEBAR_MAX_WIDTH,
    Math.max(DASHBOARD_SIDEBAR_MIN_WIDTH, width),
  );

export const isDashboardSidebarCollapsed = (width: number): boolean =>
  width <= DASHBOARD_SIDEBAR_MIN_WIDTH;
