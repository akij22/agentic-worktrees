import * as React from 'react';
import { cn } from '../../lib/utils';

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.ComponentProps<'select'>
>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      'flex h-9 w-full items-center justify-between rounded-md border border-input bg-background/65 px-3 py-1 text-sm shadow-xs transition-colors focus:outline-none focus-visible:border-ring focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  />
));

Select.displayName = 'Select';
