import * as React from 'react';
import { cn } from '../../lib/utils';

export const Input = ({
  className,
  ...props
}: React.ComponentProps<'input'>) => (
  <input
    className={cn(
      'flex h-9 w-full rounded-md border border-white/[0.07] bg-background/65 px-3 py-1 text-sm shadow-[inset_0_1px_2px_rgba(0,0,0,0.26)] transition-[background-color,border-color,box-shadow] placeholder:text-placeholder focus-visible:border-primary/55 focus-visible:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  />
);
