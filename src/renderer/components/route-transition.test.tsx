import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RouteTransition } from './RouteTransition';
import { getRouteTransitionSection } from './route-transition';

describe('RouteTransition', () => {
  it('classifies top-level screens into distinct transition sections', () => {
    expect(getRouteTransitionSection('/')).toBe('dashboard');
    expect(getRouteTransitionSection('/coding-agent')).toBe('coding-agent');
    expect(getRouteTransitionSection('/settings')).toBe('settings');
  });

  it('keeps all Coding Agent session paths in the Coding Agent section', () => {
    expect(getRouteTransitionSection('/coding-agent/worktree-1/run-1')).toBe(
      'coding-agent',
    );
    expect(getRouteTransitionSection('/coding-agent/unexpected/nested/path')).toBe(
      'coding-agent',
    );
  });

  it('matches the existing Dashboard redirect behavior for unknown paths', () => {
    expect(getRouteTransitionSection('/unknown')).toBe('dashboard');
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
