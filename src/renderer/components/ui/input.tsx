import * as React from 'react';
import { cn } from '../../lib/utils';

export const Input = ({
  className,
  ...props
}: React.ComponentProps<'input'>) => (
  <input
    className={cn(
      'flex h-9 w-full rounded-md border border-input bg-background/65 px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-placeholder focus-visible:border-ring focus-visible:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  />
);
