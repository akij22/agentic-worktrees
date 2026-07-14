import { describe, expect, it } from 'vitest';
import {
  clampDashboardSidebarWidth,
  DASHBOARD_SIDEBAR_DEFAULT_WIDTH,
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
    expect(clampDashboardSidebarWidth(208)).toBe(208);
    expect(clampDashboardSidebarWidth(380)).toBe(320);
  });

  it('uses the compact icon-only state at the minimum dashboard width', () => {
    expect(DASHBOARD_SIDEBAR_DEFAULT_WIDTH).toBe(72);
    expect(isDashboardSidebarCollapsed(72)).toBe(true);
    expect(isDashboardSidebarCollapsed(88)).toBe(false);
  });
});
