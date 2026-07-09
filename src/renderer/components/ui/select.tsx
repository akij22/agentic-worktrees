import * as React from 'react';
import { cn } from '../../lib/utils';

export const Select = ({
  className,
  ...props
}: React.ComponentProps<'select'>) => (
  <select
    className={cn(
      'flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  />
);