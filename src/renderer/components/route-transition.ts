export type RouteTransitionSection =
  | 'dashboard'
  | 'coding-agent'
  | 'settings';

export const getRouteTransitionSection = (
  pathname: string,
): RouteTransitionSection => {
  if (
    pathname === '/coding-agent' ||
    pathname.startsWith('/coding-agent/')
  ) {
    return 'coding-agent';
  }

  if (pathname === '/settings' || pathname.startsWith('/settings/')) {
    return 'settings';
  }

  return 'dashboard';
};
