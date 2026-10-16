import { describe, expect, it } from 'vitest';
import {
  isFullBleedWorkspace,
} from './app-shell-layout';

describe('App shell layout', () => {
  it('treats the chat landing, threads, worktrees and intelligence as full-height workspaces', () => {
    expect(isFullBleedWorkspace('/')).toBe(true);
    expect(isFullBleedWorkspace('/chat')).toBe(true);
    expect(isFullBleedWorkspace('/chat/worktree/run')).toBe(true);
    expect(isFullBleedWorkspace('/worktrees')).toBe(true);
    expect(isFullBleedWorkspace('/intelligence')).toBe(true);
  });

  it('lets settings and marketplace own their full-height layouts', () => {
    expect(isFullBleedWorkspace('/settings')).toBe(true);
    expect(isFullBleedWorkspace('/marketplace')).toBe(true);
  });

  it('no longer claims the retired coding-agent paths as a workspace', () => {
    expect(isFullBleedWorkspace('/coding-agent')).toBe(false);
    expect(isFullBleedWorkspace('/coding-agent/worktree/run')).toBe(false);
  });

});
