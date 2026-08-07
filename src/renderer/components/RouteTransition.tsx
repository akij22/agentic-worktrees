import type { ReactNode } from 'react';
import { cn } from '../lib/utils';
import { getRouteTransitionSection } from './route-transition';

interface RouteTransitionProps {
  pathname: string;
  className?: string;
  children: ReactNode;
}

export const RouteTransition = ({
  pathname,
  className,
  children,
}: RouteTransitionProps) => (
  <div
    key={getRouteTransitionSection(pathname)}
    className={cn('route-screen-enter', className)}
  >
    {children}
  </div>
);
