import * as React from 'react';
import { cn } from '../../lib/utils';

type Variant = 'default' | 'secondary' | 'outline' | 'destructive';

const variants: Record<Variant, string> = {
  default: 'bg-primary text-primary-foreground',
  secondary: 'bg-secondary text-secondary-foreground',
  outline: 'bg-muted/65 text-foreground',
  destructive:
    'bg-destructive text-destructive-foreground',
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
      'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium transition-colors',
      variants[variant],
      className,
    )}
    {...props}
  />
);
