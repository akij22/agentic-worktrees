import { describe, expect, it } from 'vitest';
import {
  clampNavSidebarWidth,
  isFullBleedWorkspace,
  isNavSidebarCollapsed,
  NAV_SIDEBAR_DEFAULT_WIDTH,
  NAV_SIDEBAR_EXPANDED_MIN_WIDTH,
} from './app-shell-layout';

describe('App shell layout', () => {
  it('treats the chat landing, threads, worktrees and intelligence as full-height workspaces', () => {
    expect(isFullBleedWorkspace('/')).toBe(true);
    expect(isFullBleedWorkspace('/chat')).toBe(true);
    expect(isFullBleedWorkspace('/chat/worktree/run')).toBe(true);
    expect(isFullBleedWorkspace('/worktrees')).toBe(true);
    expect(isFullBleedWorkspace('/intelligence')).toBe(true);
  });

  it('keeps padded pages out of the full-height branch', () => {
    expect(isFullBleedWorkspace('/settings')).toBe(false);
    expect(isFullBleedWorkspace('/marketplace')).toBe(false);
  });

  it('no longer claims the retired coding-agent paths as a workspace', () => {
    expect(isFullBleedWorkspace('/coding-agent')).toBe(false);
    expect(isFullBleedWorkspace('/coding-agent/worktree/run')).toBe(false);
  });

  it('keeps the navigation width within its usable range', () => {
    expect(clampNavSidebarWidth(40)).toBe(72);
    expect(clampNavSidebarWidth(176)).toBe(72);
    expect(clampNavSidebarWidth(NAV_SIDEBAR_EXPANDED_MIN_WIDTH)).toBe(192);
    expect(clampNavSidebarWidth(208)).toBe(208);
    expect(clampNavSidebarWidth(380)).toBe(320);
  });

  it('switches directly between compact and usable expanded widths', () => {
    expect(NAV_SIDEBAR_DEFAULT_WIDTH).toBe(72);
    expect(isNavSidebarCollapsed(72)).toBe(true);
    expect(isNavSidebarCollapsed(176)).toBe(true);
    expect(isNavSidebarCollapsed(192)).toBe(false);
  });
});
