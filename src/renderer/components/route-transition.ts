export type RouteTransitionSection =
  | 'chat'
  | 'worktrees'
  | 'intelligence'
  | 'marketplace'
  | 'settings';

export const getRouteTransitionSection = (
  pathname: string,
): RouteTransitionSection => {
  if (pathname === '/chat' || pathname.startsWith('/chat/')) {
    return 'chat';
  }

  if (pathname === '/worktrees') {
    return 'worktrees';
  }

  if (pathname === '/intelligence' || pathname.startsWith('/intelligence/')) {
    return 'intelligence';
  }

  if (pathname === '/marketplace' || pathname.startsWith('/marketplace/')) {
    return 'marketplace';
  }

  if (pathname === '/settings' || pathname.startsWith('/settings/')) {
    return 'settings';
  }

  return 'chat';
};
