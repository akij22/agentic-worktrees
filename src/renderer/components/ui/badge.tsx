import * as React from 'react';
import { cn } from '../../lib/utils';

type Variant = 'default' | 'secondary' | 'outline' | 'destructive';

const variants: Record<Variant, string> = {
  default: 'border-transparent bg-primary text-primary-foreground',
  secondary: 'border-transparent bg-secondary text-secondary-foreground',
  outline: 'text-foreground',
  destructive:
    'border-transparent bg-destructive text-destructive-foreground',
};

export interface BadgeProps extends React.ComponentProps<'span'> {
  variant?: Variant;
}

export const Badge = ({
  className,
  variant = 'default',
  ...props
}: BadgeProps) => (
  <span
    className={cn(
      'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium transition-colors',
      variants[variant],
      className,
    )}
    {...props}
  />
);