import * as React from 'react';
import { cn } from '../../lib/utils';

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.ComponentProps<'select'>
>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      'flex h-9 w-full items-center justify-between rounded-md border border-white/[0.07] bg-background/65 px-3 py-1 text-sm shadow-[inset_0_1px_2px_rgba(0,0,0,0.26)] transition-[background-color,border-color,box-shadow] focus:outline-none focus-visible:border-primary/55 focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  />
));

Select.displayName = 'Select';
