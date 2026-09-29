import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RouteTransition } from './RouteTransition';
import { getRouteTransitionSection } from './route-transition';

describe('RouteTransition', () => {
  it('classifies top-level screens into distinct transition sections', () => {
    expect(getRouteTransitionSection('/')).toBe('chat');
    expect(getRouteTransitionSection('/worktrees')).toBe('worktrees');
    expect(getRouteTransitionSection('/intelligence')).toBe('intelligence');
    expect(getRouteTransitionSection('/marketplace')).toBe('marketplace');
    expect(getRouteTransitionSection('/settings')).toBe('settings');
  });

  it('keeps the chat landing and every thread in one section', () => {
    expect(getRouteTransitionSection('/chat')).toBe('chat');
    expect(getRouteTransitionSection('/chat/worktree-1/run-1')).toBe('chat');
    expect(getRouteTransitionSection('/chat/unexpected/nested/path')).toBe(
      'chat',
    );
  });

  it('sends unknown paths to the chat landing section', () => {
    expect(getRouteTransitionSection('/unknown')).toBe('chat');
  });

  it('renders an animated layout wrapper without changing its content', () => {
    const markup = renderToStaticMarkup(
      <RouteTransition pathname="/settings" className="h-full">
        <span>Settings content</span>
      </RouteTransition>,
    );

    expect(markup).toContain('class="route-screen-enter h-full"');
    expect(markup).toContain('<span>Settings content</span>');
  });
});
