import { describe, expect, it } from 'vitest';
import {
  clampDashboardSidebarWidth,
  DASHBOARD_SIDEBAR_DEFAULT_WIDTH,
  DASHBOARD_SIDEBAR_EXPANDED_MIN_WIDTH,
  isDashboardSidebarCollapsed,
  isDashboardWorkspace,
} from './app-shell-layout';

describe('App shell layout', () => {
  it('uses the repository workspace only for the Dashboard root', () => {
    expect(isDashboardWorkspace('/')).toBe(true);
    expect(isDashboardWorkspace('/coding-agent')).toBe(false);
    expect(isDashboardWorkspace('/coding-agent/worktree/run')).toBe(false);
    expect(isDashboardWorkspace('/settings')).toBe(false);
  });

  it('keeps the dashboard navigation width within its usable range', () => {
    expect(clampDashboardSidebarWidth(40)).toBe(72);
    expect(clampDashboardSidebarWidth(176)).toBe(72);
    expect(clampDashboardSidebarWidth(DASHBOARD_SIDEBAR_EXPANDED_MIN_WIDTH)).toBe(192);
    expect(clampDashboardSidebarWidth(208)).toBe(208);
    expect(clampDashboardSidebarWidth(380)).toBe(320);
  });

  it('switches directly between compact and usable expanded widths', () => {
    expect(DASHBOARD_SIDEBAR_DEFAULT_WIDTH).toBe(72);
    expect(isDashboardSidebarCollapsed(72)).toBe(true);
    expect(isDashboardSidebarCollapsed(176)).toBe(true);
    expect(isDashboardSidebarCollapsed(192)).toBe(false);
  });
});
